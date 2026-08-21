import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Context } from 'cordis'
import { SessionPersistence } from './base.js'
import type { StoredSession } from './types.js'
import type { SessionEvent, SessionHeader } from '../types/session.js'
import { interruptedTurnClosers } from '../session/repair.js'

export interface SqlitePersistenceConfig {
  dbPath?: string
}

/**
 * 基于 Node 24 原生 node:sqlite 的关系型会话持久化后端：
 * 1. 零第三方依赖，纯 Node.js 内置 DatabaseSync；
 * 2. 严格遵循 ACID 事务保证，高并发与多任务读写安全；
 * 3. 自动主键索引（session_id, seq），具备极致的查询性能；
 * 4. 同样通过通用的持久化契约测试，证明 Seam 架构的完全可互换性。
 */
export class SqliteSessionPersistence extends SessionPersistence {
  private dbPath: string
  private db!: DatabaseSync

  constructor(ctx: Context, config: SqlitePersistenceConfig = {}) {
    super(ctx, 'sessionPersistence')
    this.dbPath = config.dbPath || join(process.cwd(), '.sessions', 'sessions.db')
    this.initDb()
  }

  private initDb(): void {
    // 确保数据库所在目录存在
    const dir = dirname(this.dbPath)
    try {
      import('node:fs').then(f => f.mkdirSync(dir, { recursive: true }))
    } catch {
      // ignore
    }

    this.db = new DatabaseSync(this.dbPath)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec('PRAGMA foreign_keys = ON;')

    // 创建表结构
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        cwd TEXT,
        parent_session TEXT
      );

      CREATE TABLE IF NOT EXISTS session_events (
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        time INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (session_id, seq),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_events_session ON session_events(session_id, seq);
    `)
  }

  async create(header: SessionHeader): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO sessions (id, version, created_at, cwd, parent_session)
      VALUES (?, ?, ?, ?, ?)
    `)
    stmt.run(
      header.id,
      header.version,
      header.createdAt,
      header.cwd ?? null,
      header.parentSession ?? null,
    )
  }

  async append(sessionId: string, events: readonly SessionEvent[]): Promise<void> {
    if (events.length === 0) return

    // 确保头部存在
    const header = this.sessionHeaders.get(sessionId) || {
      id: sessionId,
      version: 1,
      createdAt: Date.now(),
    }
    await this.create(header)

    const insertEvent = this.db.prepare(`
      INSERT OR REPLACE INTO session_events (session_id, seq, type, time, data)
      VALUES (?, ?, ?, ?, ?)
    `)

    // 事务批量提交
    this.db.exec('BEGIN TRANSACTION;')
    try {
      for (const e of events) {
        insertEvent.run(sessionId, e.seq, e.type, e.time, JSON.stringify(e.data))
      }
      this.db.exec('COMMIT;')
    } catch (err) {
      this.db.exec('ROLLBACK;')
      throw err
    }
  }

  async load(sessionId: string): Promise<StoredSession> {
    const sessionRow = this.db
      .prepare('SELECT id, version, created_at, cwd, parent_session FROM sessions WHERE id = ?')
      .get(sessionId) as any

    if (!sessionRow) {
      throw new Error(`Session "${sessionId}" not found in SQLite database`)
    }

    const header: SessionHeader = {
      id: sessionRow.id,
      version: sessionRow.version,
      createdAt: sessionRow.created_at,
      cwd: sessionRow.cwd ?? undefined,
      parentSession: sessionRow.parent_session ?? undefined,
    }

    const eventRows = this.db
      .prepare('SELECT seq, type, time, data FROM session_events WHERE session_id = ? ORDER BY seq ASC')
      .all(sessionId) as any[]

    const rawEvents: SessionEvent[] = eventRows.map((r) => ({
      seq: r.seq,
      type: r.type,
      time: r.time,
      data: JSON.parse(r.data),
    }))

    // 智能崩溃恢复检测与修复
    const closers = interruptedTurnClosers(rawEvents)
    if (closers.length > 0) {
      const insertEvent = this.db.prepare(`
        INSERT OR REPLACE INTO session_events (session_id, seq, type, time, data)
        VALUES (?, ?, ?, ?, ?)
      `)
      this.db.exec('BEGIN TRANSACTION;')
      try {
        for (const c of closers) {
          insertEvent.run(sessionId, c.seq, c.type, c.time, JSON.stringify(c.data))
        }
        this.db.exec('COMMIT;')
      } catch (err) {
        this.db.exec('ROLLBACK;')
        throw err
      }
      rawEvents.push(...closers)
    }

    return {
      header,
      events: rawEvents,
    }
  }

  async list(): Promise<SessionHeader[]> {
    const rows = this.db
      .prepare('SELECT id, version, created_at, cwd, parent_session FROM sessions ORDER BY created_at DESC')
      .all() as any[]

    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      createdAt: r.created_at,
      cwd: r.cwd ?? undefined,
      parentSession: r.parent_session ?? undefined,
    }))
  }
}
