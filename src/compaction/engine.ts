import { Context, Service } from 'cordis'
import type { Agent } from '../agent/index.js'
import type { Session, SessionEvent } from '../session/index.js'
import type { ContentBlock, Message } from '../types/blocks.js'
import type { CompactionConfig, CompactionResult, CompactionTrigger } from './types.js'
import { balanceToolPairingRange, estimateEventTokens } from './tool-pairing.js'
import { summarizeHistory } from './summarizer.js'

declare module 'cordis' {
  interface Context {
    compaction: CompactionEngine
  }
  interface Events {
    'compaction/done'(session: Session, result: CompactionResult): void
  }
}

export class CompactionEngine extends Service {
  readonly config: Required<CompactionConfig>
  private counter = 0

  constructor(ctx: Context, config: CompactionConfig = {}) {
    super(ctx, 'compaction')
    this.config = {
      thresholdTokens: config.thresholdTokens ?? 8000,
      thresholdTurns: config.thresholdTurns ?? 8,
      retainRecentTurns: config.retainRecentTurns ?? 2,
      retainTokens: config.retainTokens ?? 1500,
      maxSummaryTokens: config.maxSummaryTokens ?? 800,
      summarizationModel: config.summarizationModel ?? '',
      auto: config.auto ?? true,
    }
  }

  /**
   * 估算给定会话或事件列表的累积 Token 开销
   */
  estimateTokens(sessionOrEvents: Session | readonly SessionEvent[]): number {
    const events = 'events' in sessionOrEvents ? sessionOrEvents.events : sessionOrEvents
    let total = 0
    for (const e of events) {
      total += estimateEventTokens(e)
    }
    return total
  }

  /**
   * 自动探测是否达到压缩阈值（根据 Token 压力或模型溢出重试）
   */
  async compactIfNeeded(
    agent: Agent,
    trigger: CompactionTrigger,
    signal?: AbortSignal,
  ): Promise<CompactionResult | null> {
    const session = agent.session
    const totalTokens = this.estimateTokens(session)

    // 获取当前历史已完成的轮次数
    let maxTurn = 0
    for (const e of session.events) {
      if (e.type === 'turn/start' && e.data.turn > maxTurn) {
        maxTurn = e.data.turn
      }
    }

    if (trigger === 'pressure') {
      const reachedTokens = totalTokens >= this.config.thresholdTokens
      const reachedTurns = maxTurn >= this.config.thresholdTurns
      if (!reachedTokens && !reachedTurns) {
        return null
      }
    }

    return this.compactNow(agent, signal)
  }

  /**
   * 立即对当前智能体会话执行一次压缩（按需压缩 / 手动压缩）
   */
  async compactNow(agent: Agent, signal?: AbortSignal): Promise<CompactionResult | null> {
    const session = agent.session
    const events = session.events

    // 1. 查找已有压缩所遮蔽的序号
    const alreadyShadowed = new Set<number>()
    for (const e of events) {
      if (e.type === 'compaction/summary') {
        const seqs = (e.data as any).shadowedSeqs
        if (Array.isArray(seqs)) {
          for (const s of seqs) alreadyShadowed.add(s)
        }
      }
    }

    // 2. 查找全部未被遮蔽的可视化表面事件序号 (Surface Seqs)
    const activeSeqs: number[] = []
    for (const e of events) {
      if (alreadyShadowed.has(e.seq)) continue
      if (
        e.type === 'user/message' ||
        e.type === 'assistant/message' ||
        e.type === 'tool/call' ||
        e.type === 'tool/result' ||
        e.type === 'context/message' ||
        e.type === 'steering/message'
      ) {
        activeSeqs.push(e.seq)
      }
    }

    if (activeSeqs.length < 4) {
      // 可压缩事件太少，无需压缩
      return null
    }

    // 3. 计算保留尾部区间 (Tail Retention)
    // 找出最后 retainRecentTurns 轮对应的事件序号
    const turnToSeqs = new Map<number, number[]>()
    for (const seq of activeSeqs) {
      const e = events[seq]
      const turn = (e.data as any)?.turn || 0
      if (!turnToSeqs.has(turn)) turnToSeqs.set(turn, [])
      turnToSeqs.get(turn)!.push(seq)
    }

    const allTurns = Array.from(turnToSeqs.keys()).sort((a, b) => a - b)
    const turnsToRetain = new Set(allTurns.slice(-this.config.retainRecentTurns))

    const candidateSeqs = activeSeqs.filter((seq) => {
      const e = events[seq]
      const turn = (e.data as any)?.turn || 0
      return !turnsToRetain.has(turn)
    })

    if (candidateSeqs.length < 2) {
      return null
    }

    // 4. 工具调用配对平衡检查
    const balancedSeqs = balanceToolPairingRange(events, candidateSeqs)
    if (balancedSeqs.length < 2) {
      return null
    }

    const start = balancedSeqs[0]
    const end = balancedSeqs[balancedSeqs.length - 1]

    return this.compactRegion(agent, { start, end }, signal)
  }

  /**
   * 针对显式区间执行事务型三段式安全压缩：
   * compaction/start (加锁) -> compaction/summary (存证) -> compaction/end (解锁)
   */
  async compactRegion(
    agent: Agent,
    range: { start: number; end: number },
    signal?: AbortSignal,
  ): Promise<CompactionResult> {
    const session = agent.session
    const events = session.events
    const compactionId = `cmp_${Date.now()}_${++this.counter}`

    // 检查是否有未闭合的活动锁
    let hasOpenLock = false
    for (const e of events) {
      if (e.type === 'compaction/start') hasOpenLock = true
      else if (e.type === 'compaction/end') hasOpenLock = false
    }
    if (hasOpenLock) {
      throw new Error(`[Compaction] Session ${session.id} 正在执行另一个压缩事务，拒绝并发加锁`)
    }

    // 筛选位于该区间内的有效事件
    const candidateSeqs: number[] = []
    let shadowedTokenCount = 0
    for (let seq = range.start; seq <= range.end; seq++) {
      const e = events[seq]
      if (e) {
        candidateSeqs.push(seq)
        shadowedTokenCount += estimateEventTokens(e)
      }
    }

    // 平衡工具配对
    const balancedSeqs = balanceToolPairingRange(events, candidateSeqs)
    if (balancedSeqs.length === 0) {
      throw new Error('[Compaction] 无法找到平衡的工具调用边界，压缩中止')
    }

    // 获取当前轮次
    let currentTurn: number | null = null
    for (const e of events) {
      if (e.type === 'turn/start') currentTurn = e.data.turn
      else if (e.type === 'turn/end') currentTurn = null
    }

    // 1. 追加 compaction/start 锁定
    const startEvent = session.append('compaction/start', {
      compactionId,
      turn: currentTurn,
    })

    let summary: ContentBlock[] = [{ type: 'text', text: '前序历史已被压缩。' }]
    const model = this.config.summarizationModel || agent.options.model || 'default'

    try {
      // 2. 将待压缩事件临时投影为供摘要提炼的消息切片
      const candidateMessages: Message[] = []
      for (const seq of balancedSeqs) {
        const e = events[seq]
        if (!e) continue
        if (e.type === 'user/message') {
          candidateMessages.push({ role: 'user', content: structuredClone(e.data.content) as ContentBlock[] })
        } else if (e.type === 'assistant/message') {
          if (e.data.content.length > 0) {
            candidateMessages.push({ role: 'assistant', content: structuredClone(e.data.content) as ContentBlock[] })
          }
        } else if (e.type === 'tool/result') {
          candidateMessages.push({
            role: 'user',
            content: [{ type: 'tool-result', toolCallId: e.data.callId, content: e.data.content }],
          })
        }
      }

      // 调用 LLM 提炼多轮摘要
      summary = await summarizeHistory(this.ctx, candidateMessages, model, signal)
    } catch (err: any) {
      session.append('compaction/end', {
        compactionId,
        turn: currentTurn,
        error: err?.message || String(err),
      })
      throw err
    }

    // 3. 追加 compaction/summary 存证
    const summaryEvent = session.append('compaction/summary', {
      compactionId,
      summary,
      shadowedRange: { start: balancedSeqs[0], end: balancedSeqs[balancedSeqs.length - 1] },
      shadowedSeqs: balancedSeqs,
      shadowedTokenCount,
      provider: (agent.options as any).provider,
      model,
    })

    // 4. 追加 compaction/end 释放锁
    const endEvent = session.append('compaction/end', {
      compactionId,
      turn: currentTurn,
    })

    const result: CompactionResult = {
      compactionId,
      startSeq: startEvent.seq,
      summarySeq: summaryEvent.seq,
      endSeq: endEvent.seq,
      summary,
      shadowedRange: { start: balancedSeqs[0], end: balancedSeqs[balancedSeqs.length - 1] },
      shadowedSeqs: balancedSeqs,
      shadowedTokenCount,
    }

    this.ctx.emit('compaction/done', session, result)
    return result
  }
}

export default CompactionEngine
