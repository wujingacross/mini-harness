import { Context, Service } from 'cordis'
import type { Agent, AgentOptions, AgentStatus } from '../agent/index.js'
import type { Session, TurnEndReason } from '../session/index.js'
import type { ContentBlock, TextBlock, ToolCallBlock } from '../types/blocks.js'
import { BlockAssembler } from '../types/stream.js'
import { renderPrompt } from '../system-prompt/index.js'
import type { SessionPersistence } from '../session-persistence/index.js'
import type { CompactionEngine } from '../compaction/index.js'
import type { PlanModeController } from '../plan/index.js'

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

  private get compaction(): CompactionEngine | undefined {
    return this.ctx.get('compaction') as CompactionEngine | undefined
  }

  private get planMode(): PlanModeController | undefined {
    return this.ctx.get('planMode') as PlanModeController | undefined
  }

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

    // 拦截 /compact 手动压缩命令
    if (blocks.length === 1 && blocks[0].type === 'text' && blocks[0].text.trim() === '/compact') {
      void this.executeManualCompaction()
      return
    }

    // 拦截 /plan 相关控制命令
    if (blocks.length === 1 && blocks[0].type === 'text') {
      const text = blocks[0].text.trim()
      if (text === '/plan off') {
        const planMode = this.planMode
        if (planMode) {
          const outcome = planMode.set(this.session, false, 'plan_off')
          const msg = outcome === 'committed'
            ? 'Plan mode off.'
            : 'Leaving plan mode (applies from the next step).'
          this.session.append('context/message', {
            content: [{ type: 'text', text: msg }],
            source: 'system',
          })
          this.ctx.emit('session/event', this.session, this.session.events[this.session.events.length - 1])
        }
        return
      }

      if (text === '/plan') {
        const planMode = this.planMode
        if (planMode) {
          const outcome = planMode.set(this.session, true, 'user_command')
          const msg = outcome === 'committed'
            ? 'Plan mode on. Use /plan off to leave.'
            : 'Entering plan mode (applies from the next step). Use /plan off to leave.'
          this.session.append('context/message', {
            content: [{ type: 'text', text: msg }],
            source: 'system',
          })
          this.ctx.emit('session/event', this.session, this.session.events[this.session.events.length - 1])
        }
        return
      }

      if (text.startsWith('/plan ')) {
        const planMode = this.planMode
        const instruction = text.slice(6).trim()
        if (planMode) {
          planMode.set(this.session, true, 'user_command')
        }
        if (instruction) {
          this.inbox.push([{ type: 'text', text: instruction }])
          if (this.status === 'idle') {
            void this.drainInbox()
          }
        }
        return
      }
    }

    this.inbox.push(blocks)
    if (this.status === 'idle') {
      void this.drainInbox()
    }
  }

  /**
   * 手动触发会话压缩 (/compact)
   */
  async executeManualCompaction(): Promise<void> {
    if (this.status === 'running') {
      this.session.append('context/message', {
        content: [{ type: 'text', text: '当前智能体正在执行任务，请等待本轮任务完成后再执行 /compact。' }],
        source: 'system',
      })
      return
    }

    this.status = 'running'
    this.ctx.emit('agent/status', this, 'running')
    try {
      if (this.compaction) {
        const res = await this.compaction.compactNow(this)
        if (res) {
          this.session.append('assistant/message', {
            turn: this.turnCounter,
            step: 1,
            content: [
              {
                type: 'text',
                text: `✅ **会话历史已成功压缩** (Compaction ID: \`${res.compactionId}\`)\n- 被折叠历史事件：${res.shadowedSeqs.length} 条 (Seq ${res.shadowedRange.start} ~ ${res.shadowedRange.end})\n- 估算释放 Token：约 ${res.shadowedTokenCount} tokens\n- 关键上下文已转录为结构化摘要，后续轮次将无缝继承该摘要。`,
              },
            ],
          })
        } else {
          this.session.append('assistant/message', {
            turn: this.turnCounter,
            step: 1,
            content: [{ type: 'text', text: '当前会话历史较短或处于保留区间内，无需进行压缩。' }],
          })
        }
      } else {
        this.session.append('assistant/message', {
          turn: this.turnCounter,
          step: 1,
          content: [{ type: 'text', text: '系统未装载压缩插件 (CompactionEngine)。' }],
        })
      }
    } catch (err: any) {
      this.session.append('assistant/message', {
        turn: this.turnCounter,
        step: 1,
        content: [{ type: 'text', text: `❌ 压缩执行失败: ${err?.message || String(err)}` }],
      })
    } finally {
      this.status = 'idle'
      this.ctx.emit('agent/status', this, 'idle')
      await this.ctx.parallel('session/flush', this.session)
      this.notifyIdle()
    }
  }

  /**
   * 中途干预与航向纠偏（Mid-turn Steering）：
   * 在 Agent 正在执行多步任务（running）时，直接向当前 Turn 注入即时干预信息，
   * 下一步（Step）大模型在派生历史消息时会立即看到 <steering> 指示并调整后续行动。
   */
  steer(content: ContentBlock[] | string): void {
    const blocks: ContentBlock[] =
      typeof content === 'string' ? [{ type: 'text', text: content }] : content

    if (this.status === 'running') {
      if (blocks.length === 1 && blocks[0].type === 'text') {
        const text = blocks[0].text.trim()
        if (text === '/plan off') {
          this.planMode?.set(this.session, false, 'plan_off')
          return
        }
        if (text === '/plan') {
          this.planMode?.set(this.session, true, 'user_command')
          return
        }
        if (text.startsWith('/plan ')) {
          this.planMode?.set(this.session, true, 'user_command')
          const instruction = text.slice(6).trim()
          if (instruction) {
            this.steer([{ type: 'text', text: instruction }])
          }
          return
        }
      }

      this.session.append('steering/message', {
        turn: this.turnCounter,
        content: blocks,
        source: 'user',
      })
    } else {
      this.send(blocks)
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

      // Pre-step: 自动压力压缩探测 (Compaction Pressure Check)
      if (this.compaction && this.compaction.config.auto && !signal.aborted) {
        try {
          await this.compaction.compactIfNeeded(this, 'pressure', signal)
        } catch (err: any) {
          this.ctx.logger?.warn?.(`[Compaction] 步进自动压缩异常: ${err?.message || err}`)
        }
      }

      // 1. 装配提示词
      const assembly = await this.ctx.systemPrompt.assemble(this.session)
      const systemText = [renderPrompt(assembly, this.session), this.options.systemPrompt].filter(Boolean).join('\n\n')

      // 2. 从事件流派生当前消息历史 (deriveMessages 纯函数投影，自动包含 steering 并过滤已压缩历史)
      const messages = this.session.deriveMessages()

      // 3. 调用大模型流式生成
      const assembler = new BlockAssembler()
      const model = this.options.model ?? 'default'

      try {
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
      } catch (err: any) {
        const msg = String(err?.message || err)
        if (
          (msg.includes('context_length_exceeded') ||
            msg.includes('maximum context length') ||
            msg.includes('too long') ||
            msg.includes('tokens exceeds')) &&
          this.compaction &&
          !signal.aborted
        ) {
          const res = await this.compaction.compactIfNeeded(this, 'context-overflow', signal)
          if (res) {
            step--
            continue
          }
        }
        throw err
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
          session: this.session,
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
    const session = this.ctx.sessions.get(id) || this.ctx.sessions.create(id)
    const agent = new ReactLoopAgent(this.ctx, id, session, options)
    this.ctx.agents.register(agent)
    return agent
  }

  /**
   * 从持久化存储中恢复指定会话，并无缝挂载为活跃的 Agent 实例
   */
  async resumeAgent(sessionId: string, agentId?: string, options: AgentOptions = {}): Promise<Agent> {
    const persistence = this.ctx.get('sessionPersistence') as SessionPersistence | undefined
    if (!persistence) {
      throw new Error('SessionPersistence service (ctx.sessionPersistence) is not registered')
    }

    const { header, events } = await persistence.load(sessionId)
    const session = this.ctx.sessions.create(header.id, events, header)
    const targetAgentId = agentId || `resumed-${sessionId}`
    const agent = new ReactLoopAgent(this.ctx, targetAgentId, session, options)
    this.ctx.agents.register(agent)
    return agent
  }
}

export default AgentLoop
