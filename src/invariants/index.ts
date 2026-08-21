import type { Context } from 'cordis'
import type { Session, SessionEvent } from '../session/index.js'

export class InvariantError extends Error {
  constructor(message: string) {
    super(`[Invariant Violated] ${message}`)
    this.name = 'InvariantError'
  }
}

export interface InvariantsConfig {
  freeze?: boolean // 是否开启事件不可变深度冻结 (默认 true)
}

interface SessionTrace {
  lastSeq: number
  openTurn: number | null
  openStep: number | null
  nextTurn: number
  nextStep: number
  pendingCalls: Set<string>
}

function deepFreeze(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)
  Object.freeze(value)
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key], seen)
  }
}

/**
 * 运行时不变量契约校验插件 (Invariants Guard)：
 * 1. 严格校验事件流单调自增序号 (seq Contiguity)；
 * 2. 严格校验 Turn / Step 嵌套状态机生命周期（防非法跨 Turn / 悬挂 Step）；
 * 3. 严格校验 Tool Call / Result 闭环匹配；
 * 4. Deep-Freeze 深度冻结已持久化的事件对象，彻底杜绝下游插件篡改历史日志。
 */
export function applyInvariants(ctx: Context, config: InvariantsConfig = {}) {
  const shouldFreeze = config.freeze !== false
  const traces = new WeakMap<Session, SessionTrace>()

  function getTrace(session: Session): SessionTrace {
    let trace = traces.get(session)
    if (!trace) {
      trace = {
        lastSeq: -1,
        openTurn: null,
        openStep: null,
        nextTurn: 1,
        nextStep: 1,
        pendingCalls: new Set(),
      }
      traces.set(session, trace)
    }
    return trace
  }

  // 监听所有新创建的 Session
  ctx.on('session/created', (session: Session) => {
    getTrace(session)
    if (session.events.length > 0 && shouldFreeze) {
      for (const e of session.events) {
        deepFreeze(e)
      }
    }
  })

  // 监听每一个追加的事件，执行严格契约断言
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    const trace = getTrace(session)

    // 1. 严格连续序号校验: seq 必须严格等于 lastSeq + 1
    if (event.seq !== trace.lastSeq + 1) {
      throw new InvariantError(
        `Event sequence gap or duplicate: expected seq ${trace.lastSeq + 1}, but received ${event.seq} (type: "${event.type}")`,
      )
    }
    trace.lastSeq = event.seq

    // 2. 状态机边界检查
    switch (event.type) {
      case 'turn/start': {
        if (trace.openTurn !== null) {
          throw new InvariantError(
            `Cannot start turn ${event.data.turn}: turn ${trace.openTurn} is still open!`,
          )
        }
        if (event.data.turn < trace.nextTurn) {
          throw new InvariantError(
            `Turn number out of order: expected >= ${trace.nextTurn}, got ${event.data.turn}`,
          )
        }
        trace.openTurn = event.data.turn
        trace.nextTurn = event.data.turn + 1
        trace.openStep = null
        trace.nextStep = 1
        trace.pendingCalls.clear()
        break
      }

      case 'turn/end': {
        if (trace.openTurn === null) {
          throw new InvariantError(
            `Cannot end turn ${event.data.turn}: no turn is currently open!`,
          )
        }
        if (trace.openTurn !== event.data.turn) {
          throw new InvariantError(
            `Turn mismatch: open turn is ${trace.openTurn}, but turn/end is for ${event.data.turn}`,
          )
        }
        trace.openTurn = null
        trace.openStep = null
        trace.pendingCalls.clear()
        break
      }

      case 'step/start': {
        if (trace.openTurn === null) {
          throw new InvariantError(
            `Cannot start step outside an open turn (step ${event.data.step})`,
          )
        }
        if (trace.openStep !== null) {
          throw new InvariantError(
            `Cannot start step ${event.data.step}: step ${trace.openStep} is still open!`,
          )
        }
        trace.openStep = event.data.step
        trace.nextStep = event.data.step + 1
        break
      }

      case 'step/end': {
        if (trace.openStep === null) {
          throw new InvariantError(
            `Cannot end step ${event.data.step}: no step is currently open!`,
          )
        }
        if (trace.openStep !== event.data.step) {
          throw new InvariantError(
            `Step mismatch: open step is ${trace.openStep}, but step/end is for ${event.data.step}`,
          )
        }
        trace.openStep = null
        break
      }

      case 'assistant/chunk':
      case 'assistant/message': {
        if (trace.openTurn !== event.data.turn || trace.openStep !== event.data.step) {
          throw new InvariantError(
            `"${event.type}" event turn/step (${event.data.turn}/${event.data.step}) does not match open (${trace.openTurn}/${trace.openStep})`,
          )
        }
        break
      }

      case 'tool/call': {
        if (trace.openTurn !== event.data.turn || trace.openStep !== event.data.step) {
          throw new InvariantError(
            `tool/call turn/step (${event.data.turn}/${event.data.step}) does not match open (${trace.openTurn}/${trace.openStep})`,
          )
        }
        trace.pendingCalls.add(event.data.callId)
        break
      }

      case 'tool/result': {
        if (trace.openTurn !== event.data.turn || trace.openStep !== event.data.step) {
          throw new InvariantError(
            `tool/result turn/step (${event.data.turn}/${event.data.step}) does not match open (${trace.openTurn}/${trace.openStep})`,
          )
        }
        trace.pendingCalls.delete(event.data.callId)
        break
      }
    }

    // 3. 深度冻结防止后续篡改
    if (shouldFreeze) {
      deepFreeze(event)
    }
  })
}

export default applyInvariants
