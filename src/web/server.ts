import http from 'node:http'
import { existsSync, promises as fs } from 'node:fs'
import { extname, isAbsolute, join, normalize, relative } from 'node:path'
import { Context, Service } from 'cordis'
import type { Agent } from '../agent/index.js'
import { ReactLoopAgent } from '../agent-loop/index.js'
import type { SessionPersistenceService } from '../session-persistence/types.js'
import { deriveTodos } from '../todo/index.js'
import type { PlanModeController } from '../plan/index.js'

export interface WebServerConfig {
  port?: number
  host?: string
  workspaceDir?: string
  webDistDir?: string
  model?: string
  systemPrompt?: string
}

declare module 'cordis' {
  interface Context {
    webServer: WebServer
  }
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.ts': 'application/javascript; charset=utf-8',
  '.tsx': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
}

/**
 * WebServer: 对齐 deepseek-harness 官方 host-webserver 与 frontend-static 设计
 * 提供真正的静态前端资源分发 (SPA dist server) 与 REST/SSE 双工下行流
 */
export class WebServer extends Service {
  static inject = ['sessions', 'agentLoop']
  public server: http.Server | null = null
  public port: number
  public host: string
  private workspaceDir: string
  private explicitDistDir?: string
  private defaultModel: string
  private defaultSystemPrompt?: string
  private activeAgents = new Map<string, Agent>()

  constructor(ctx: Context, config: WebServerConfig = {}) {
    super(ctx, 'webServer')
    this.port = config.port !== undefined ? config.port : 3000
    this.host = config.host || '127.0.0.1'
    this.workspaceDir = config.workspaceDir || process.cwd()
    this.explicitDistDir = config.webDistDir
    this.defaultModel = config.model || 'deepseek-chat'
    this.defaultSystemPrompt = config.systemPrompt
  }

  private getActiveDistDir(): string {
    if (this.explicitDistDir) return this.explicitDistDir
    const distPath = join(this.workspaceDir, 'web/dist')
    if (existsSync(join(distPath, 'index.html'))) {
      return distPath
    }
    return join(this.workspaceDir, 'web')
  }

  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          console.error('[WebServer Error]', err)
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: err?.message || String(err) }))
          }
        })
      })

      const tryListen = (port: number) => {
        this.server?.listen(port, this.host, () => {
          const addr = this.server?.address()
          const actualPort = typeof addr === 'object' && addr ? addr.port : port
          this.port = actualPort
          const url = `http://${this.host}:${actualPort}`
          resolve(url)
        })
      }

      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE' && this.port !== 0) {
          this.port += 1
          tryListen(this.port)
          return
        }
        reject(err)
      })

      tryListen(this.port)
    })
  }

  stop(): void {
    if (this.server) {
      this.server.close()
      this.server = null
    }
  }

  private getOrCreateAgent(sessionId: string, model?: string): Agent {
    let agent = this.activeAgents.get(sessionId)
    const effectiveModel = model || this.defaultModel
    if (!agent) {
      const existingSession = this.ctx.sessions.get(sessionId)
      if (existingSession) {
        agent = new ReactLoopAgent(this.ctx, `agent-${sessionId}`, existingSession, {
          model: effectiveModel,
          systemPrompt: this.defaultSystemPrompt,
        })
        this.ctx.agents.register(agent)
      } else {
        agent = this.ctx.agentLoop.createAgent(sessionId, {
          model: effectiveModel,
          systemPrompt: this.defaultSystemPrompt,
        })
      }
      this.activeAgents.set(sessionId, agent)
    } else if (model && (agent as any).options) {
      ;(agent as any).options.model = model
    }
    return agent
  }

  private async parseJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        if (!body) return resolve({})
        try {
          resolve(JSON.parse(body))
        } catch (err) {
          reject(new Error('Invalid JSON payload'))
        }
      })
      req.on('error', reject)
    })
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const pathname = url.pathname
    const method = req.method?.toUpperCase() || 'GET'

    // CORS & Options
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // 1. API Routes (/api/*)
    if (pathname.startsWith('/api/')) {
      await this.handleApiRequest(pathname, method, req, res)
      return
    }

    // 2. Static File Serving (对齐 host-frontend-static 的 SPA dist server)
    await this.serveStaticFile(pathname, res)
  }

  private async serveStaticFile(pathname: string, res: http.ServerResponse): Promise<void> {
    const activeDist = this.getActiveDistDir()
    let relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '')
    relPath = normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '')

    let filePath = join(activeDist, relPath)

    try {
      let stat = await fs.stat(filePath)
      if (stat.isDirectory()) {
        filePath = join(filePath, 'index.html')
        stat = await fs.stat(filePath)
      }

      const ext = extname(filePath).toLowerCase()
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'

      const content = await fs.readFile(filePath)
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': content.length,
        'Cache-Control': 'no-cache',
      })
      res.end(content)
    } catch {
      // SPA Fallback: 不匹配的静态路由回退到 index.html
      const indexPath = join(activeDist, 'index.html')
      try {
        const indexContent = await fs.readFile(indexPath)
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': indexContent.length,
        })
        res.end(indexContent)
      } catch (err: any) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end(`404 Not Found: Static dist not found at ${activeDist}`)
      }
    }
  }

  private async handleApiRequest(pathname: string, method: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // GET /api/models - List Available Models
    if (pathname === '/api/models' && method === 'GET') {
      const models = (this.ctx.llm as any)?.listModels?.() || ['deepseek-chat', 'deepseek-reasoner']
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        models,
        defaultModel: this.defaultModel,
      }))
      return
    }

    // GET /api/sessions - List Sessions
    if (pathname === '/api/sessions' && method === 'GET') {
      const activeIds = this.ctx.sessions.list()
      const persistence = this.ctx.get('sessionPersistence') as SessionPersistenceService | undefined
      const headerMap = new Map<string, any>()
      if (persistence) {
        const headers = await persistence.list()
        for (const h of headers) {
          headerMap.set(h.id, h)
        }
      }

      const allIds = Array.from(new Set([...activeIds, ...headerMap.keys()]))
      const sessionList = await Promise.all(
        allIds.map(async (id) => {
          let ses = this.ctx.sessions.get(id)
          if (!ses && persistence) {
            const loaded = await persistence.load(id)
            if (loaded) {
              ses = this.ctx.sessions.create(id, loaded.events, loaded.header)
            }
          }

          let title = ''
          if (ses) {
            const userEvt = ses.events.find((e) => e.type === 'user/message')
            if (userEvt) {
              const c = userEvt.data.content as any
              if (typeof c === 'string') {
                title = c
              } else if (Array.isArray(c)) {
                title = c[0]?.text || (typeof c[0] === 'string' ? c[0] : '')
              } else if (c?.text) {
                title = c.text
              }
            }
          }

          if (!title) {
            title = id.startsWith('ses_') ? '新会话' : id
          }

          const createdAt = ses?.header?.createdAt || headerMap.get(id)?.createdAt || 0
          const planMode = this.ctx.get('planMode') as PlanModeController | undefined
          const planState = ses && planMode ? planMode.getState(ses) : { active: false, pending: false }
          const todos = ses ? deriveTodos(ses) : []
          const todosCount = {
            total: todos.length,
            completed: todos.filter(t => t.status === 'completed').length,
            inProgress: todos.filter(t => t.status === 'in_progress').length,
          }

          return {
            id,
            title: title.slice(0, 32),
            createdAt,
            eventsCount: ses?.events.length || 0,
            plan: planState,
            todosCount,
          }
        })
      )

      // Sort by createdAt descending (newest at the top)
      sessionList.sort((a, b) => {
        if (b.createdAt !== a.createdAt) {
          return b.createdAt - a.createdAt
        }
        return b.id.localeCompare(a.id)
      })

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ sessions: sessionList }))
      return
    }

    // POST /api/sessions - Create New Session
    if (pathname === '/api/sessions' && method === 'POST') {
      const newSession = this.ctx.sessions.create()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ sessionId: newSession.id }))
      return
    }

    // GET /api/sessions/:id - Get Session Detail
    const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/)
    if (sessionMatch && method === 'GET') {
      const sessionId = sessionMatch[1]!
      let session = this.ctx.sessions.get(sessionId)

      if (!session) {
        const persistence = this.ctx.get('sessionPersistence') as SessionPersistenceService | undefined
        if (persistence) {
          const loaded = await persistence.load(sessionId)
          if (loaded) {
            session = this.ctx.sessions.create(sessionId, loaded.events, loaded.header)
          }
        }
      }

      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: `Session "${sessionId}" not found` }))
        return
      }

      const planMode = this.ctx.get('planMode') as PlanModeController | undefined
      const plan = planMode ? planMode.getState(session) : { active: false, pending: false }
      const todos = deriveTodos(session)

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ sessionId: session.id, events: session.events, plan, todos }))
      return
    }

    // DELETE /api/sessions/:id - Delete Session
    if (sessionMatch && method === 'DELETE') {
      const sessionId = sessionMatch[1]!
      this.ctx.sessions.delete(sessionId)
      this.activeAgents.delete(sessionId)
      const persistence = this.ctx.get('sessionPersistence') as any
      if (persistence && typeof persistence.delete === 'function') {
        await persistence.delete(sessionId)
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'deleted', sessionId }))
      return
    }

    // GET /api/sessions/:id/events - SSE Stream
    const eventsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/events$/)
    if (eventsMatch && method === 'GET') {
      const sessionId = eventsMatch[1]!
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })
      res.write(': connected\n\n')

      const dispose = this.ctx.on('session/event', (ses, event) => {
        if (ses.id === sessionId) {
          res.write(`data: ${JSON.stringify(event)}\n\n`)
        }
      })

      req.on('close', () => {
        dispose()
      })
      return
    }

    // POST /api/sessions/:id/prompt - Send Prompt
    const promptMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/prompt$/)
    if (promptMatch && method === 'POST') {
      const sessionId = promptMatch[1]!
      const body = await this.parseJsonBody(req)
      const prompt = body.prompt
      const model = body.model

      if (!prompt) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing prompt in request body' }))
        return
      }

      const agent = this.getOrCreateAgent(sessionId, model)
      agent.send(prompt)

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'accepted', sessionId, model }))
      return
    }

    // POST /api/sessions/:id/cancel - Cancel Execution
    const cancelMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/cancel$/)
    if (cancelMatch && method === 'POST') {
      const sessionId = cancelMatch[1]!
      const agent = this.activeAgents.get(sessionId)
      if (agent) {
        agent.cancel('Cancelled from Web Dashboard')
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'cancelled', sessionId }))
      return
    }

    // POST /api/sessions/:id/steer - Mid-turn Steering
    const steerMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/steer$/)
    if (steerMatch && method === 'POST') {
      const sessionId = steerMatch[1]!
      const body = await this.parseJsonBody(req)
      const agent = this.activeAgents.get(sessionId)
      if (agent && body.message) {
        agent.steer(body.message)
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'steered', sessionId }))
      return
    }

    // POST /api/sessions/:id/compact - Trigger Manual Compaction
    const compactMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/compact$/)
    if (compactMatch && method === 'POST') {
      const sessionId = compactMatch[1]!
      const agent = this.getOrCreateAgent(sessionId)
      const compaction = this.ctx.get('compaction') as any
      if (!compaction) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Compaction service is not enabled on this server' }))
        return
      }
      try {
        const result = await compaction.compactNow(agent)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: result ? 'compacted' : 'noop', result, sessionId }))
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err?.message || String(err), sessionId }))
      }
      return
    }

    // POST /api/sessions/:id/plan - Toggle Plan Mode
    const planToggleMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/plan$/)
    if (planToggleMatch && method === 'POST') {
      const sessionId = planToggleMatch[1]!
      const session = this.ctx.sessions.get(sessionId)
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: `Session "${sessionId}" not found` }))
        return
      }
      const body = await this.parseJsonBody(req)
      const active = Boolean(body.active)
      const planMode = this.ctx.get('planMode') as PlanModeController | undefined
      if (!planMode) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'PlanMode service is not loaded' }))
        return
      }
      const outcome = planMode.set(session, active, active ? 'user_command' : 'plan_off')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: outcome, plan: planMode.getState(session) }))
      return
    }

    // POST /api/sessions/:id/plan/approve - Approve Plan and Exit Plan Mode
    const planApproveMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/plan\/approve$/)
    if (planApproveMatch && method === 'POST') {
      const sessionId = planApproveMatch[1]!
      const session = this.ctx.sessions.get(sessionId)
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: `Session "${sessionId}" not found` }))
        return
      }
      const planMode = this.ctx.get('planMode') as PlanModeController | undefined
      if (!planMode) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'PlanMode service is not loaded' }))
        return
      }
      planMode.set(session, false, 'plan_approved')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'approved', plan: planMode.getState(session) }))
      return
    }

    // GET /api/files - List Workspace Files
    if (pathname === '/api/files' && method === 'GET') {
      const files = await this.listWorkspaceFiles(this.workspaceDir)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ files }))
      return
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: `Not Found: ${pathname}` }))
  }

  private async listWorkspaceFiles(dir: string, base = dir, max = 200): Promise<string[]> {
    const excludes = ['node_modules', '.git', 'dist', '.sessions', '.tmp-test-']
    const result: string[] = []

    const scan = async (curDir: string) => {
      if (result.length >= max) return
      try {
        const entries = await fs.readdir(curDir, { withFileTypes: true })
        for (const entry of entries) {
          if (result.length >= max) break
          const full = join(curDir, entry.name)
          const rel = relative(base, full)

          if (excludes.some((ex) => rel === ex || rel.startsWith(`${ex}/`) || rel.includes(`/${ex}/`))) {
            continue
          }

          if (entry.isDirectory()) {
            await scan(full)
          } else if (entry.isFile()) {
            result.push(rel)
          }
        }
      } catch {
        // ignore read error
      }
    }

    await scan(dir)
    return result
  }
}

export default WebServer
