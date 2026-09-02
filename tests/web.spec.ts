import { describe, it, expect, afterEach } from 'vitest'
import { Context } from 'cordis'
import SessionStore from '../src/session/index.js'
import SystemPrompt from '../src/system-prompt/index.js'
import ToolRegistry from '../src/tools/index.js'
import LlmService from '../src/llm/index.js'
import { MockLlmAdapter } from '../src/llm/mock.js'
import AgentRegistry from '../src/agent/index.js'
import AgentLoop from '../src/agent-loop/index.js'
import WebServer from '../src/web/index.js'

describe('Milestone 7: Web UI Server & Dashboard', () => {
  let ctx: Context
  let serverUrl: string

  afterEach(() => {
    if (ctx?.webServer) {
      ctx.webServer.stop()
    }
  })

  async function startTestServer(port = 0) {
    ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(LlmService)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop)

    // Register Mock LLM
    ctx.llm.registerAdapter(['mock', 'default', 'deepseek-chat'], new MockLlmAdapter())

    // Register Echo Tool
    ctx.tools.register({
      name: 'echo',
      description: 'echoes',
      parameters: { type: 'object', properties: { text: { type: 'string' } } },
      execute: (args: any) => `ECHO: ${args.text || args.message}`,
    })

    await ctx.plugin(WebServer, {
      port,
      host: '127.0.0.1',
      model: 'mock',
    })

    serverUrl = await ctx.webServer.start()
    return { ctx, serverUrl }
  }

  it('serves static frontend files and assets (HTML, CSS, JS)', async () => {
    const { serverUrl } = await startTestServer()

    // 1. GET / -> index.html
    const htmlRes = await fetch(`${serverUrl}/`)
    expect(htmlRes.status).toBe(200)
    expect(htmlRes.headers.get('content-type')).toContain('text/html')
    const html = await htmlRes.text()
    expect(html).toContain('deepseek HARNESS')
    expect(html).toContain('id="root"')

    // 2. Dynamic asset verification from built bundle
    const jsMatch = html.match(/src="(\/assets\/[^"]+\.js)"/)
    const cssMatch = html.match(/href="(\/assets\/[^"]+\.css)"/)

    if (jsMatch) {
      const jsRes = await fetch(`${serverUrl}${jsMatch[1]}`)
      expect(jsRes.status).toBe(200)
      expect(jsRes.headers.get('content-type')).toContain('application/javascript')
    }

    if (cssMatch) {
      const cssRes = await fetch(`${serverUrl}${cssMatch[1]}`)
      expect(cssRes.status).toBe(200)
      expect(cssRes.headers.get('content-type')).toContain('text/css')
    }
  })

  it('handles session lifecycle and file listing via REST API', async () => {
    const { serverUrl } = await startTestServer()

    // 1. Create Session
    const createRes = await fetch(`${serverUrl}/api/sessions`, { method: 'POST' })
    expect(createRes.status).toBe(200)
    const { sessionId } = await createRes.json()
    expect(sessionId).toBeDefined()

    // 2. List Sessions
    const listRes = await fetch(`${serverUrl}/api/sessions`)
    const { sessions } = await listRes.json()
    expect(sessions.some((s: any) => s.id === sessionId)).toBe(true)

    // 3. Get Session Detail
    const detailRes = await fetch(`${serverUrl}/api/sessions/${sessionId}`)
    expect(detailRes.status).toBe(200)
    const detail = await detailRes.json()
    expect(detail.sessionId).toBe(sessionId)

    // 4. List Files
    const filesRes = await fetch(`${serverUrl}/api/files`)
    expect(filesRes.status).toBe(200)
    const { files } = await filesRes.json()
    expect(Array.isArray(files)).toBe(true)
    expect(files.some((f: string) => f.includes('package.json'))).toBe(true)
  })

  it('handles prompt submission and executes agent loop to completion', async () => {
    const { ctx, serverUrl } = await startTestServer()

    // Create session
    const createRes = await fetch(`${serverUrl}/api/sessions`, { method: 'POST' })
    const { sessionId } = await createRes.json()

    // Send Prompt
    const promptRes = await fetch(`${serverUrl}/api/sessions/${sessionId}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'echo hello-web' }),
    })
    expect(promptRes.status).toBe(200)

    // Wait for agent turn to finish
    const agent = ctx.webServer['activeAgents'].get(sessionId)
    expect(agent).toBeDefined()
    await agent?.whenIdle()

    // Verify session events populated
    const detailRes = await fetch(`${serverUrl}/api/sessions/${sessionId}`)
    const { events } = await detailRes.json()
    expect(events.length).toBeGreaterThan(0)
    expect(events.some((e: any) => e.type === 'turn/end')).toBe(true)
  })

  it('streams live SSE events including tool/call and tool/result', async () => {
    const { ctx, serverUrl } = await startTestServer()

    // 1. Create Session
    const createRes = await fetch(`${serverUrl}/api/sessions`, { method: 'POST' })
    const { sessionId } = await createRes.json()

    // 2. Open SSE stream
    const events: any[] = []
    const controller = new AbortController()
    const sseRes = await fetch(`${serverUrl}/api/sessions/${sessionId}/events`, {
      signal: controller.signal,
    })
    expect(sseRes.status).toBe(200)

    const reader = sseRes.body?.getReader()
    const decoder = new TextDecoder()
    let sseDone = false

    const readStream = async () => {
      let buffer = ''
      try {
        while (!sseDone) {
          const { done, value } = await reader!.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (line.startsWith('data:')) {
              const data = JSON.parse(line.slice(5).trim())
              events.push(data)
            }
          }
        }
      } catch {
        // aborted
      }
    }

    const readPromise = readStream()

    // 3. Send Prompt triggering echo tool
    await fetch(`${serverUrl}/api/sessions/${sessionId}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'echo live-test' }),
    })

    const agent = ctx.webServer['activeAgents'].get(sessionId)
    await agent?.whenIdle()

    // Wait short time for SSE flush
    await new Promise((r) => setTimeout(r, 100))

    sseDone = true
    controller.abort()
    await readPromise

    expect(events.some((e) => e.type === 'turn/start')).toBe(true)
    expect(events.some((e) => e.type === 'tool/call' && (e.data.callId || e.data.id))).toBe(true)
    expect(events.some((e) => e.type === 'tool/result' && e.data.content.includes('live-test'))).toBe(true)
    expect(events.some((e) => e.type === 'turn/end')).toBe(true)
  })
})
