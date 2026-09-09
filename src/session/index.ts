import { Context, Service } from 'cordis'
import type { ContentBlock, Message } from '../types/blocks.js'
import {
  SESSION_FORMAT_VERSION,
  type SessionEvent,
  type SessionEventMap,
  type SessionEventType,
  type SessionHeader,
} from '../types/session.js'

export * from '../types/session.js'
export * from './repair.js'

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

function renderTagged(tag: string, content: ContentBlock[], source?: string): ContentBlock[] {
  const open = `<${tag} source="${source ?? 'unknown'}">`
  const close = `</${tag}>`
  return [
    { type: 'text', text: open },
    ...content,
    { type: 'text', text: close },
  ]
}

export class Session {
  private log: SessionEvent[] = []
  readonly header: SessionHeader
  onAppend?: (event: SessionEvent) => void

  constructor(id: string, seed?: SessionEvent[], header?: Partial<SessionHeader>) {
    this.header = {
      id,
      version: header?.version ?? SESSION_FORMAT_VERSION,
      createdAt: header?.createdAt ?? Date.now(),
      cwd: header?.cwd,
      parentSession: header?.parentSession,
    }

    if (seed) {
      this.log = seed.map((event) => structuredClone(event))
    }
  }

  get id(): string {
    return this.header.id
  }

  get events(): readonly SessionEvent[] {
    return this.log
  }

  get seq(): number {
    return this.log.length
  }

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

  deriveMessages(): Message[] {
    const messages: Message[] = []

    // 收集所有被压缩操作遮蔽的历史事件序号 (seq) 与起始替换位置映射
    const shadowedSeqs = new Set<number>()
    const summaryAtStartSeq = new Map<number, ContentBlock[]>()

    for (const event of this.log) {
      if (event.type === 'compaction/summary') {
        const data = event.data as SessionEventMap['compaction/summary']
        if (Array.isArray(data.shadowedSeqs)) {
          for (const s of data.shadowedSeqs) {
            shadowedSeqs.add(s)
          }
        }
        if (data.shadowedRange && data.summary) {
          summaryAtStartSeq.set(data.shadowedRange.start, data.summary)
        }
      }
    }

    for (const event of this.log) {
      // 1. 若该序号是压缩区间的起始位置，在此处前置注入压缩摘要！
      if (summaryAtStartSeq.has(event.seq)) {
        const summary = summaryAtStartSeq.get(event.seq)!
        if (summary.length > 0) {
          messages.push({
            role: 'user',
            content: renderTagged('context', structuredClone(summary), 'compaction'),
          })
        }
      }

      // 2. 若该事件已被压缩遮蔽，或者其本身是日志末尾存证的 compaction/summary，则在模型视界中跳过
      if (shadowedSeqs.has(event.seq) || event.type === 'compaction/summary') {
        continue
      }

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

  create(id?: string, seed?: SessionEvent[], header?: Partial<SessionHeader>): Session {
    const sessionId = id ?? `ses_${Date.now()}_${++this.counter}`
    const session = new Session(sessionId, seed, header)
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

  delete(id: string): boolean {
    return this.store.delete(id)
  }

  list(): string[] {
    return Array.from(this.store.keys())
  }
}

export default SessionStore
