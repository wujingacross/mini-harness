import { Context, Service } from 'cordis'
import type { Agent, AgentOptions, AgentStatus } from '../agent/index.js'
import type { Session, TurnEndReason } from '../session/index.js'
import type { ContentBlock, TextBlock, ToolCallBlock } from '../types/blocks.js'
import { BlockAssembler } from '../types/stream.js'
import { renderPrompt } from '../system-prompt/index.js'

declare module 'cordis' {
  interface Context {
    agentLoop: AgentLoop
  }
}

/** ReAct Agent 状态机执行实例：管理会话生命周期与 ReAct 多步循环 */
export class ReactLoopAgent implements Agent {
  readonly id: string
  readonly options: AgentOptions
  readonly session: Session
  status: AgentStatus = 'idle'

  /** 消息收件箱队列（防并发冲突，顺序排队处理） */
  private inbox: ContentBlock[][] = []
  /** whenIdle 异步等待者 Promise 解析回调池 */
  private idleWaiters: (() => void)[] = []
  private turnCounter = 0
  private abortController?: AbortController

  constructor(
    private ctx: Context,
    id: string,
    session: Session,
    options: AgentOptions = {},
  ) {
    this.id = id
    this.session = session
    this.options = options
  }

  /** 外部统一触发入口：将消息推入收件箱，若空闲则启动消费循环 */
  send(content: ContentBlock[] | string): void {
    const blocks: ContentBlock[] =
      typeof content === 'string' ? [{ type: 'text', text: content }] : content

    this.inbox.push(blocks)
    if (this.status === 'idle') {
      void this.drainInbox()
    }
  }

  /** 中途取消当前任务 */
  cancel(reason?: string): void {
    this.inbox = []
    if (this.abortController) {
      this.abortController.abort(reason ?? 'cancelled')
    }
  }

  /** 异步等待屏障：返回 Promise，直到 Agent 完成收件箱所有任务切回 idle 时 resolve */
  whenIdle(): Promise<void> {
    if (this.status === 'idle' && this.inbox.length === 0) {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.idleWaiters.push(resolve)
    })
  }

  /** 唤醒所有 whenIdle 等待者 */
  private notifyIdle(): void {
    const waiters = [...this.idleWaiters]
    this.idleWaiters = []
    for (const w of waiters) w()
  }

  /** 顺序消费收件箱队列中的消息轮次 */
  private async drainInbox(): Promise<void> {
    if (this.status === 'running') return

    while (this.inbox.length > 0) {
      const userBlocks = this.inbox.shift()
      if (!userBlocks) continue

      this.status = 'running'
      this.ctx.emit('agent/status', this, 'running')
      const turn = ++this.turnCounter

      try {
        await this.runTurn(turn, userBlocks)
      } catch (err: any) {
        this.session.append('turn/end', {
          turn,
          reason: { kind: 'error', step: 1, message: err?.message || String(err) },
        })
        this.ctx.emit('agent/turn-end', this, turn, {
          kind: 'error',
          step: 1,
          message: err?.message || String(err),
        })
      } finally {
        this.status = 'idle'
        this.ctx.emit('agent/status', this, 'idle')
        await this.ctx.parallel('session/flush', this.session)
      }
    }

    this.notifyIdle()
  }

  /** 执行单轮对话的核心 ReAct 多步循环 */
  private async runTurn(turn: number, userBlocks: ContentBlock[]): Promise<void> {
    this.abortController = new AbortController()
    const signal = this.abortController.signal

    this.session.append('turn/start', { turn, trigger: { kind: 'message', source: 'user' } })
    this.ctx.emit('agent/turn-start', this, turn)

    this.session.append('user/message', { content: userBlocks, source: 'user' })

    let step = 0
    const maxSteps = 10
    let endReason: TurnEndReason = { kind: 'completed' }

    while (step < maxSteps) {
      if (signal.aborted) {
        endReason = { kind: 'aborted', reason: signal.reason }
        break
      }

      step++
      this.session.append('step/start', { turn, step })
      this.ctx.emit('agent/step-start', this, turn, step)

      // 1. 装配系统提示词与可用工具 Schema
      const assembly = await this.ctx.systemPrompt.assemble(this.session)
      const systemText = [renderPrompt(assembly), this.options.systemPrompt].filter(Boolean).join('\n\n')

      // 2. 从底层事件日志中投影计算出当前 Message[] 历史
      const messages = this.session.deriveMessages()

      // 3. 调用 LLM 服务进行流式推理
      const assembler = new BlockAssembler()
      const model = this.options.model ?? 'default'

      const stream = this.ctx.llm.stream({
        model,
        systemPrompt: systemText,
        messages,
        tools: assembly.tools,
        signal,
      })

      // 4. 实时消费流式分片并由 BlockAssembler 增量拼装
      for await (const chunk of stream) {
        this.session.append('assistant/chunk', { turn, step, chunk })
        this.ctx.emit('agent/chunk', this, chunk)
        assembler.push(chunk)
      }

      // 5. 固化模型返回的消息并写入事件日志
      const assistantBlocks = assembler.blocks()
      this.session.append('assistant/message', {
        turn,
        step,
        content: assistantBlocks,
        usage: assembler.usage,
      })

      this.session.append('step/end', { turn, step })
      this.ctx.emit('agent/step-end', this, turn, step)

      // 6. 检查大模型是否发起了工具调用
      const toolCalls = assistantBlocks.filter(
        (b): b is ToolCallBlock => b.type === 'tool-call',
      )

      if (toolCalls.length === 0) {
        // 无工具调用，表明模型给出了最终回复，轮次正常结束
        endReason = { kind: 'completed' }
        break
      }

      // 7. 顺序执行工具调用并记录结果（驱动进入下一个 Step 闭环）
      for (const call of toolCalls) {
        if (signal.aborted) break

        this.session.append('tool/call', {
          turn,
          step,
          callId: call.id,
          name: call.name,
          arguments: call.arguments,
        })
        // 广播工具调用事件（供 UI 实时展示卡片等可观测性渲染）
        this.ctx.emit('agent/tool-call', this, {
          id: call.id,
          name: call.name,
          arguments: call.arguments,
        })

        // 真正触发工具代码执行（经由 Waterfall 中间件流水线）
        const res = await this.ctx.tools.execute({
          callId: call.id,
          name: call.name,
          arguments: call.arguments,
        })

        // 记录工具返回结果至日志，供下一步 deriveMessages 喂回模型
        this.session.append('tool/result', {
          turn,
          step,
          callId: call.id,
          content: res.content,
          isError: res.isError,
        })
        // 广播工具结果事件
        this.ctx.emit('agent/tool-result', this, {
          callId: call.id,
          content: res.content,
          isError: res.isError,
        })
      }
    }

    this.session.append('turn/end', { turn, reason: endReason })
    this.ctx.emit('agent/turn-end', this, turn, endReason)
  }
}

/** 微内核 Agent 管理与调度服务 */
export class AgentLoop extends Service {
  static inject = ['llm', 'sessions', 'systemPrompt', 'tools', 'agents']

  constructor(ctx: Context) {
    super(ctx, 'agentLoop')
  }

  /** 创建并注册一个全新的 ReAct Agent 实例 */
  createAgent(id: string, options: AgentOptions = {}): Agent {
    const session = this.ctx.sessions.create(id)
    const agent = new ReactLoopAgent(this.ctx, id, session, options)
    this.ctx.agents.register(agent)
    return agent
  }
}

export default AgentLoop
