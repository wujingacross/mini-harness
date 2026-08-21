import { Context, Service } from 'cordis'
import type { Session, SessionEvent, SessionHeader } from '../session/index.js'
import { SessionPersistenceService, type StoredSession } from './types.js'

declare module 'cordis' {
  interface Context {
    sessionPersistence: SessionPersistence
  }
}

export abstract class SessionPersistence extends Service implements SessionPersistenceService {
  static inject = ['sessions']
  protected writeBuffers = new Map<string, SessionEvent[]>()
  protected sessionHeaders = new Map<string, SessionHeader>()

  constructor(ctx: Context, name = 'sessionPersistence') {
    super(ctx, name)

    // 1. 监听会话创建：记录元数据
    this.ctx.on('session/created', (session: Session) => {
      this.sessionHeaders.set(session.id, session.header)
      void this.create(session.header)
    })

    // 2. 监听事件追加：进入写后缓冲池 (Write-Behind Buffer)
    this.ctx.on('session/event', (session: Session, event: SessionEvent) => {
      let buf = this.writeBuffers.get(session.id)
      if (!buf) {
        buf = []
        this.writeBuffers.set(session.id, buf)
      }
      buf.push(event)
    })

    // 3. 监听会话 Flush Checkpoint：将缓冲池增量落盘 (Drain Buffer)
    this.ctx.on('session/flush', async (session: Session) => {
      await this.flush(session.id)
    })
  }

  async flush(sessionId: string): Promise<void> {
    const buf = this.writeBuffers.get(sessionId)
    if (!buf || buf.length === 0) return

    const eventsToPersist = [...buf]
    this.writeBuffers.set(sessionId, [])

    try {
      await this.append(sessionId, eventsToPersist)
    } catch (err) {
      // 若写入失败，回滚缓冲池
      const current = this.writeBuffers.get(sessionId) || []
      this.writeBuffers.set(sessionId, [...eventsToPersist, ...current])
      throw err
    }
  }

  abstract create(header: SessionHeader): Promise<void>
  abstract append(sessionId: string, events: readonly SessionEvent[]): Promise<void>
  abstract load(sessionId: string): Promise<StoredSession>
  abstract list(): Promise<SessionHeader[]>
}
