import { Context, Service } from 'cordis'
import type { ContentBlock, Message } from '../types/blocks.js'
import type { SessionEvent, SessionEventMap, SessionEventType } from '../types/session.js'

export * from '../types/session.js'

declare module 'cordis' {
  interface Context {
    sessions: SessionStore
  }

  interface Events {
    'session/created'(session: Session): void
    'session/event'(session: Session, event: SessionEvent): void
    'session/flush'(session: Session): Promise<void> | void
  }
}

/** 将环境注入上下文 (<context>) 或纠偏指令 (<steering>) 包裹为标准 XML 结构，便于大模型区分来源与指令边界 */
function renderTagged(tag: string, content: ContentBlock[], source?: string): ContentBlock[] {
  const open = `<${tag} source="${source ?? 'unknown'}">`
  const close = `</${tag}>`
  return [
    { type: 'text', text: open },
    ...content,
    { type: 'text', text: close },
  ]
}

/** 事件溯源会话：维护单向追加的不可变事件日志 (Append-only Event Log) */
export class Session {
  private log: SessionEvent[] = []
  onAppend?: (event: SessionEvent) => void

  constructor(public readonly id: string, seed?: SessionEvent[]) {
    if (seed) {
      this.log = seed.map(event => structuredClone(event))
    }
  }

  get events(): readonly SessionEvent[] {
    return this.log
  }

  get seq(): number {
    return this.log.length
  }

  /** 追加事件：通过原生 structuredClone 深拷贝保证日志不可变性，分配单调 seq */
  append<T extends SessionEventType>(type: T, data: SessionEventMap[T]): SessionEvent<T> {
    const event = {
      type,
      seq: this.log.length,
      time: Date.now(),
      data: structuredClone(data),
    } as SessionEvent<T>

    this.log.push(event)
    this.onAppend?.(event)
    return event
  }

  /** 消息投影函数：从底层事件日志中纯函数式“投影计算”出大模型所需的标准 Message[] 对话历史 */
  deriveMessages(): Message[] {
    const messages: Message[] = []
    for (const event of this.log) {
      switch (event.type) {
        case 'user/message': {
          messages.push({ role: 'user', content: structuredClone(event.data.content) })
          break
        }
        case 'assistant/message': {
          if (event.data.content.length === 0) break
          messages.push({ role: 'assistant', content: structuredClone(event.data.content) })
          break
        }
        case 'tool/result': {
          const { callId, content, isError } = event.data
          messages.push({
            role: 'user',
            content: [{ type: 'tool-result', toolCallId: callId, content, isError }],
          })
          break
        }
        case 'context/message': {
          const { content, source } = event.data
          messages.push({ role: 'user', content: renderTagged('context', structuredClone(content), source) })
          break
        }
        case 'steering/message': {
          const { content, source } = event.data
          messages.push({ role: 'user', content: renderTagged('steering', structuredClone(content), source) })
          break
        }
      }
    }
    return messages
  }
}

export class SessionStore extends Service {
  private store = new Map<string, Session>()
  private counter = 0

  constructor(ctx: Context) {
    super(ctx, 'sessions')
  }

  create(id?: string, seed?: SessionEvent[]): Session {
    const sessionId = id ?? `ses_${Date.now()}_${++this.counter}`
    const session = new Session(sessionId, seed)
    this.store.set(sessionId, session)

    session.onAppend = (event) => {
      this.ctx.emit('session/event', session, event)
    }

    this.ctx.emit('session/created', session)
    return session
  }

  get(id: string): Session | undefined {
    return this.store.get(id)
  }
}

export default SessionStore
