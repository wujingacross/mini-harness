import type { SessionEvent } from '../types/session.js'

/**
 * 崩溃恢复修复算法（Crash-Recovery Repair）：
 * 
 * 进程可能在执行过程中异常崩溃（如掉电、OOM、强制杀死），导致最后的 Turn 处于未闭合状态。
 * 在重放/加载历史日志时，如果直接抛弃未闭合的 Turn，会丢失大量已完成的工具输出；
 * 如果原样交给大模型，未闭合的 tool_calls 会导致各大模型 API 报错（Dangling Tool Calls 协议错误）。
 * 
 * 本算法从事件流中识别未闭合状态，并智能合成最小闭合边界：
 * 1. 为每一个未收到结果的 tool-call 合成一个 isError 的 tool/result 错误占位；
 * 2. 若 Step 处于开启状态，合成 step/end；
 * 3. 合成 turn/end（标记为 aborted: 'interrupted by process crash'）。
 */
export function interruptedTurnClosers(events: readonly SessionEvent[]): SessionEvent[] {
  let openTurn: number | null = null
  let openStep: number | null = null
  const pendingCalls = new Map<string, number>() // callId -> step

  for (const event of events) {
    switch (event.type) {
      case 'turn/start':
        openTurn = event.data.turn
        openStep = null
        pendingCalls.clear()
        break
      case 'turn/end':
        openTurn = null
        openStep = null
        pendingCalls.clear()
        break
      case 'step/start':
        openStep = event.data.step
        break
      case 'step/end':
        openStep = null
        break
      case 'assistant/message':
        for (const block of event.data.content) {
          if (block.type === 'tool-call') {
            pendingCalls.set(block.id, event.data.step)
          }
        }
        break
      case 'tool/result':
        pendingCalls.delete(event.data.callId)
        break
    }
  }

  // 正常闭合，无需合成
  if (openTurn === null) {
    return []
  }

  const closers: SessionEvent[] = []
  let nextSeq = events.length
  const lastTime = events.length > 0 ? events[events.length - 1]!.time : Date.now()

  // 1. 为悬挂的 tool-calls 合成错误结果
  for (const [callId, step] of pendingCalls) {
    closers.push({
      type: 'tool/result',
      seq: nextSeq++,
      time: lastTime,
      data: {
        turn: openTurn,
        step,
        callId,
        content: '[interrupted by process crash]',
        isError: true,
      },
    })
  }

  // 2. 闭合 Step
  if (openStep !== null) {
    closers.push({
      type: 'step/end',
      seq: nextSeq++,
      time: lastTime,
      data: {
        turn: openTurn,
        step: openStep,
      },
    })
  }

  // 3. 闭合 Turn
  closers.push({
    type: 'turn/end',
    seq: nextSeq++,
    time: lastTime,
    data: {
      turn: openTurn,
      reason: { kind: 'aborted', reason: 'interrupted by process crash' },
    },
  })

  return closers
}
