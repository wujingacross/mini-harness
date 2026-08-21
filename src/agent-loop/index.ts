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

export class ReactLoopAgent implements Agent {
  readonly id: string
  readonly options: AgentOptions
  readonly session: Session
  status: AgentStatus = 'idle'

  private inbox: ContentBlock[][] = []
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

    // 计算已有历史日志中的最大 turn
    for (const e of session.events) {
      if (e.type === 'turn/start' && e.data.turn > this.turnCounter) {
        this.turnCounter = e.data.turn
      }
    }
  }

  send(content: ContentBlock[] | string): void {
    const blocks: ContentBlock[] =
      typeof content === 'string' ? [{ type: 'text', text: content }] : content

    this.inbox.push(blocks)
    if (this.status === 'idle') {
      void this.drainInbox()
    }
  }

  cancel(reason?: string): void {
    this.inbox = []
    if (this.abortController) {
      this.abortController.abort(reason ?? 'cancelled')
    }
  }

  whenIdle(): Promise<void> {
    if (this.status === 'idle' && this.inbox.length === 0) {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.idleWaiters.push(resolve)
    })
  }

  private notifyIdle(): void {
    const waiters = [...this.idleWaiters]
    this.idleWaiters = []
    for (const w of waiters) w()
  }

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

      // 1. 装配提示词
      const assembly = await this.ctx.systemPrompt.assemble(this.session)
      const systemText = [renderPrompt(assembly), this.options.systemPrompt].filter(Boolean).join('\n\n')

      // 2. 从事件流派生当前消息历史 (deriveMessages 纯函数投影)
      const messages = this.session.deriveMessages()

      // 3. 调用大模型流式生成
      const assembler = new BlockAssembler()
      const model = this.options.model ?? 'default'

      const stream = this.ctx.llm.stream({
        model,
        systemPrompt: systemText,
        messages,
        tools: assembly.tools,
        signal,
      })

      for await (const chunk of stream) {
        this.session.append('assistant/chunk', { turn, step, chunk })
        this.ctx.emit('agent/chunk', this, chunk)
        assembler.push(chunk)
      }

      const assistantBlocks = assembler.blocks()
      this.session.append('assistant/message', {
        turn,
        step,
        content: assistantBlocks,
        usage: assembler.usage,
      })

      this.session.append('step/end', { turn, step })
      this.ctx.emit('agent/step-end', this, turn, step)

      // 4. 检查是否有需要执行的工具调用
      const toolCalls = assistantBlocks.filter(
        (b): b is ToolCallBlock => b.type === 'tool-call',
      )

      if (toolCalls.length === 0) {
        endReason = { kind: 'completed' }
        break
      }

      // 执行工具调用
      for (const call of toolCalls) {
        if (signal.aborted) break

        this.session.append('tool/call', {
          turn,
          step,
          callId: call.id,
          name: call.name,
          arguments: call.arguments,
        })
        this.ctx.emit('agent/tool-call', this, {
          id: call.id,
          name: call.name,
          arguments: call.arguments,
        })

        const res = await this.ctx.tools.execute({
          callId: call.id,
          name: call.name,
          arguments: call.arguments,
        })

        this.session.append('tool/result', {
          turn,
          step,
          callId: call.id,
          content: res.content,
          isError: res.isError,
        })
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

export class AgentLoop extends Service {
  static inject = ['llm', 'sessions', 'systemPrompt', 'tools', 'agents']

  constructor(ctx: Context) {
    super(ctx, 'agentLoop')
  }

  createAgent(id: string, options: AgentOptions = {}): Agent {
    const session = this.ctx.sessions.create(id)
    const agent = new ReactLoopAgent(this.ctx, id, session, options)
    this.ctx.agents.register(agent)
    return agent
  }

  /**
   * 从持久化存储中恢复指定会话，并无缝挂载为活跃的 Agent 实例
   */
  async resumeAgent(sessionId: string, agentId?: string, options: AgentOptions = {}): Promise<Agent> {
    if (!this.ctx.sessionPersistence) {
      throw new Error('SessionPersistence service (ctx.sessionPersistence) is not registered')
    }

    const { header, events } = await this.ctx.sessionPersistence.load(sessionId)
    const session = this.ctx.sessions.create(header.id, events, header)
    const targetAgentId = agentId || `resumed-${sessionId}`
    const agent = new ReactLoopAgent(this.ctx, targetAgentId, session, options)
    this.ctx.agents.register(agent)
    return agent
  }
}

export default AgentLoop
