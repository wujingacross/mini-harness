import { describe, it, expect, beforeEach } from 'vitest'
import { PassThrough } from 'node:stream'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { Context } from 'cordis'
import SessionStore from '../src/session/index.js'
import SystemPrompt from '../src/system-prompt/index.js'
import ToolRegistry from '../src/tools/index.js'
import LlmService from '../src/llm/index.js'
import { MockLlmAdapter } from '../src/llm/mock.js'
import AgentRegistry from '../src/agent/index.js'
import AgentLoop from '../src/agent-loop/index.js'
import { JsonlSessionPersistence } from '../src/session-persistence/jsonl.js'
import { AcpBridge } from '../src/acp/bridge.js'

const testDir = join(process.cwd(), '.tmp-test-acp')

describe('Milestone 4: Agent Client Protocol (ACP) IDE Bridge', () => {
  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
    await fs.mkdir(testDir, { recursive: true })
  })

  async function createTestHarness() {
    const clientToServer = new PassThrough()
    const serverToClient = new PassThrough()

    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(LlmService)
    await ctx.plugin(JsonlSessionPersistence, { storageDir: testDir })
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop)

    ctx.llm.registerAdapter(['mock', 'default'], new MockLlmAdapter())

    ctx.tools.register({
      name: 'echo',
      description: 'echoes the message',
      parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
      execute(args: { message: string }) {
        return `ECHO_OUTPUT: ${args.message}`
      },
    })

    await ctx.plugin(AcpBridge, {
      model: 'mock',
      input: clientToServer,
      output: serverToClient,
    })

    const pendingRequests = new Map<string | number, { resolve: (res: any) => void; reject: (err: any) => void }>()
    const receivedUpdates: any[] = []

    let buffer = ''
    serverToClient.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8')
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const msg = JSON.parse(trimmed)
          if (msg.id !== undefined && pendingRequests.has(msg.id)) {
            const { resolve, reject } = pendingRequests.get(msg.id)!
            pendingRequests.delete(msg.id)
            if (msg.error) {
              reject(new Error(msg.error.message))
            } else {
              resolve(msg.result)
            }
          } else if (msg.method === 'session/update') {
            receivedUpdates.push(msg.params.update)
          }
        } catch {}
      }
    })

    let reqCounter = 0
    const sendRpc = (method: string, params: any): Promise<any> => {
      return new Promise((resolve, reject) => {
        const id = ++reqCounter
        pendingRequests.set(id, { resolve, reject })
        clientToServer.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      })
    }

    return { ctx, clientToServer, serverToClient, sendRpc, receivedUpdates }
  }

  it('handles initialize RPC successfully', async () => {
    const { sendRpc } = await createTestHarness()
    const result = await sendRpc('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'zed-test' },
    })

    expect(result.protocolVersion).toBe(1)
    expect(result.serverInfo.name).toBe('mini-harness-acp')
    expect(result.serverCapabilities.loadSession).toBe(true)
  })

  it('handles session/new, session/prompt with streaming updates and tool execution', async () => {
    const { sendRpc, receivedUpdates } = await createTestHarness()

    // 1. session/new
    const newRes = await sendRpc('session/new', { cwd: '/workspace' })
    expect(newRes.sessionId).toBeDefined()
    const sessionId = newRes.sessionId

    // 2. session/prompt (触发工具调用)
    const promptRes = await sendRpc('session/prompt', {
      sessionId,
      prompt: 'echo hello-acp',
    })

    expect(promptRes.stopReason).toBe('end_turn')

    // 验证收到的更新类型
    const types = receivedUpdates.map((u) => u.type)
    expect(types).toContain('agent_thought_chunk')
    expect(types).toContain('tool_call')
    expect(types).toContain('tool_call_update')
    expect(types).toContain('agent_message_chunk')

    const toolCall = receivedUpdates.find((u) => u.type === 'tool_call')
    expect(toolCall.name).toBe('echo')

    const toolResult = receivedUpdates.find((u) => u.type === 'tool_call_update')
    expect(toolResult.content).toContain('ECHO_OUTPUT: hello-acp')
  })

  it('handles session/load with full historical replay to IDE client', async () => {
    const { sendRpc, receivedUpdates, ctx } = await createTestHarness()

    // 先持久化一个会话
    const session = ctx.sessions.create('persisted-acp-ses')
    session.append('turn/start', { turn: 1, trigger: { kind: 'message', source: 'user' } })
    session.append('user/message', { content: [{ type: 'text', text: 'Previous user question' }] })
    session.append('assistant/message', { turn: 1, step: 1, content: [{ type: 'text', text: 'Previous answer' }] })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await ctx.parallel('session/flush', session)

    // session/load
    const loadRes = await sendRpc('session/load', {
      sessionId: 'persisted-acp-ses',
      cwd: '/workspace',
    })

    expect(loadRes.sessionId).toBe('persisted-acp-ses')

    // 验证历史记录已回放给 IDE
    const userChunk = receivedUpdates.find((u) => u.type === 'user_message_chunk')
    const agentChunk = receivedUpdates.find((u) => u.type === 'agent_message_chunk')
    expect(userChunk?.content).toBe('Previous user question')
    expect(agentChunk?.content).toBe('Previous answer')
  })
})
