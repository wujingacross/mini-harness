import type { SessionEvent, SessionHeader } from '../types/session.js'

export interface StoredSession {
  header: SessionHeader
  events: SessionEvent[]
}

/**
 * 抽象持久化服务契约（SessionPersistence Seam）：
 * 无论底层是 JSONL 文件系统还是 SQLite 数据库，均统一遵循此契约。
 */
export abstract class SessionPersistenceService {
  abstract create(header: SessionHeader): Promise<void>
  abstract append(sessionId: string, events: readonly SessionEvent[]): Promise<void>
  abstract load(sessionId: string): Promise<StoredSession>
  abstract list(): Promise<SessionHeader[]>
}
