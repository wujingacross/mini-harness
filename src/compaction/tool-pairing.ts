import type { SessionEvent } from '../types/session.js'
import type { ContentBlock } from '../types/blocks.js'

/**
 * 快速估算一段内容或事件集合的 Token 消耗量：
 * 英文及代码按约 3.5 字符/Token，中文字符按约 1.5 字符/Token
 */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0
  let tokens = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code > 0x4e00 && code < 0x9fa5) {
      tokens += 0.8
    } else if (code <= 128) {
      tokens += 0.28
    } else {
      tokens += 0.6
    }
  }
  return Math.ceil(tokens)
}

export function estimateContentBlocksTokens(blocks: ContentBlock[]): number {
  let total = 0
  for (const b of blocks) {
    if (b.type === 'text') {
      total += estimateTokensFromText(b.text)
    } else if (b.type === 'reasoning') {
      total += estimateTokensFromText(b.text)
    } else if (b.type === 'tool-call') {
      total += estimateTokensFromText(b.name) + estimateTokensFromText(JSON.stringify(b.arguments)) + 10
    } else if (b.type === 'tool-result') {
      total += estimateTokensFromText(b.content) + 10
    }
  }
  return total
}

export function estimateEventTokens(event: SessionEvent): number {
  switch (event.type) {
    case 'user/message':
    case 'context/message':
    case 'steering/message':
      return estimateContentBlocksTokens(event.data.content)
    case 'assistant/message':
      if (event.data.usage) {
        return (event.data.usage.promptTokens || 0) + (event.data.usage.completionTokens || 0)
      }
      return estimateContentBlocksTokens(event.data.content)
    case 'tool/call':
      return estimateTokensFromText(event.data.name) + estimateTokensFromText(JSON.stringify(event.data.arguments)) + 15
    case 'tool/result':
      return estimateTokensFromText(event.data.content) + 15
    default:
      return 5
  }
}

/**
 * 工具配对平衡边界修剪：
 * 确保选定的压缩序列区间内，任何包含在内的 tool/call 必须同时包含其对应的 tool/result。
 * 若发现未完成配对的 tool/call，则将结束边界安全后退，排除未配对的调用。
 */
export function balanceToolPairingRange(
  events: readonly SessionEvent[],
  candidateSeqs: number[],
): number[] {
  if (candidateSeqs.length === 0) return []

  const seqSet = new Set(candidateSeqs)
  const callMap = new Map<string, number>() // callId -> seq
  const resultMap = new Map<string, number>() // callId -> seq

  for (const seq of candidateSeqs) {
    const evt = events[seq]
    if (!evt) continue
    if (evt.type === 'tool/call') {
      callMap.set((evt.data as any).callId, seq)
    } else if (evt.type === 'tool/result') {
      resultMap.set((evt.data as any).callId, seq)
    }
  }

  // 检查是否有 tool/call 在范围内，但 tool/result 不在范围内
  const unclosedCallSeqs = new Set<number>()
  for (const [callId, callSeq] of callMap.entries()) {
    if (!resultMap.has(callId)) {
      unclosedCallSeqs.add(callSeq)
    }
  }

  // 如果存在未配对的 tool/call，排除这些 tool/call
  if (unclosedCallSeqs.size > 0) {
    return candidateSeqs.filter((seq) => !unclosedCallSeqs.has(seq))
  }

  return candidateSeqs
}
