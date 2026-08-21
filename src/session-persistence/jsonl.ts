import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Context } from 'cordis'
import { SessionPersistence } from './base.js'
import type { StoredSession } from './types.js'
import type { SessionEvent, SessionHeader } from '../types/session.js'
import { interruptedTurnClosers } from '../session/repair.js'

export interface JsonlPersistenceConfig {
  storageDir?: string
}

/**
 * 基于 JSONL 格式的会话持久化后端：
 * 1. 一会话一文件（.sessions/{sessionId}.jsonl）；
 * 2. 首行存储 SessionHeader 元数据；
 * 3. 后续每行单调追加一个 SessionEvent；
 * 4. 内置崩溃恢复：加载时若发现未闭合 Turn，自动合成边界事件并原子同步修补落盘。
 */
export class JsonlSessionPersistence extends SessionPersistence {
  private storageDir: string

  constructor(ctx: Context, config: JsonlPersistenceConfig = {}) {
    super(ctx, 'sessionPersistence')
    this.storageDir = config.storageDir || join(process.cwd(), '.sessions')
  }

  private getFilePath(sessionId: string): string {
    return join(this.storageDir, `${sessionId}.jsonl`)
  }

  private async ensureStorageDir(): Promise<void> {
    await fs.mkdir(this.storageDir, { recursive: true })
  }

  async create(header: SessionHeader): Promise<void> {
    await this.ensureStorageDir()
    const filePath = this.getFilePath(header.id)
    try {
      await fs.access(filePath)
      // 文件已存在，无需重复创建
    } catch {
      const headerLine = JSON.stringify({ _header: true, ...header }) + '\n'
      await fs.writeFile(filePath, headerLine, 'utf-8')
    }
  }

  async append(sessionId: string, events: readonly SessionEvent[]): Promise<void> {
    if (events.length === 0) return
    await this.ensureStorageDir()

    const filePath = this.getFilePath(sessionId)
    // 确保头部存在
    try {
      await fs.access(filePath)
    } catch {
      const header = this.sessionHeaders.get(sessionId) || {
        id: sessionId,
        version: 1,
        createdAt: Date.now(),
      }
      await this.create(header)
    }

    const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n'
    await fs.appendFile(filePath, lines, 'utf-8')
  }

  async load(sessionId: string): Promise<StoredSession> {
    const filePath = this.getFilePath(sessionId)
    let content: string
    try {
      content = await fs.readFile(filePath, 'utf-8')
    } catch (err: any) {
      throw new Error(`Failed to load session "${sessionId}": ${err?.message || String(err)}`)
    }

    const lines = content.split('\n').filter((l) => l.trim().length > 0)
    if (lines.length === 0) {
      throw new Error(`Session file "${filePath}" is empty`)
    }

    const first = JSON.parse(lines[0]!)
    const header: SessionHeader = first._header ? first : {
      id: sessionId,
      version: 1,
      createdAt: Date.now(),
    }

    const rawEvents: SessionEvent[] = []
    const startIdx = first._header ? 1 : 0

    for (let i = startIdx; i < lines.length; i++) {
      try {
        rawEvents.push(JSON.parse(lines[i]!))
      } catch {
        // 忽略可能由于进程异常被截断的最后半行非完整 JSON (Torn Tail)
      }
    }

    // 智能崩溃恢复检测与修复
    const closers = interruptedTurnClosers(rawEvents)
    if (closers.length > 0) {
      // 将修复事件写回文件，持久化修复结果
      const repairLines = closers.map((e) => JSON.stringify(e)).join('\n') + '\n'
      await fs.appendFile(filePath, repairLines, 'utf-8')
      rawEvents.push(...closers)
    }

    return {
      header,
      events: rawEvents,
    }
  }

  async list(): Promise<SessionHeader[]> {
    await this.ensureStorageDir()
    const files = await fs.readdir(this.storageDir)
    const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'))

    const results: SessionHeader[] = []
    for (const f of jsonlFiles) {
      const filePath = join(this.storageDir, f)
      try {
        const handle = await fs.open(filePath, 'r')
        const buffer = Buffer.alloc(1024)
        const { bytesRead } = await handle.read(buffer, 0, 1024, 0)
        await handle.close()

        const firstLine = buffer.toString('utf-8', 0, bytesRead).split('\n')[0]
        if (firstLine) {
          const parsed = JSON.parse(firstLine)
          if (parsed._header) {
            results.push(parsed)
          } else {
            results.push({
              id: f.replace(/\.jsonl$/, ''),
              version: 1,
              createdAt: Date.now(),
            })
          }
        }
      } catch {
        // ignore corrupted file in listing
      }
    }

    return results.sort((a, b) => b.createdAt - a.createdAt)
  }
}
