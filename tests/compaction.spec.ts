import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Context } from 'cordis'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import SessionStore, { Session } from '../src/session/index.js'
import SystemPrompt from '../src/system-prompt/index.js'
import ToolRegistry from '../src/tools/index.js'
import LlmService from '../src/llm/index.js'
import { MockLlmAdapter } from '../src/llm/mock.js'
import AgentRegistry from '../src/agent/index.js'
import AgentLoop, { ReactLoopAgent } from '../src/agent-loop/index.js'
import CompactionEngine from '../src/compaction/engine.js'
import { balanceToolPairingRange, estimateEventTokens } from '../src/compaction/tool-pairing.js'
import WebServer from '../src/web/server.js'

describe('Milestone 8: Context Compaction & Truncation Management', () => {
  let ctx: Context
  let mockAdapter: MockLlmAdapter

  beforeEach(async () => {
    ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(LlmService)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop)
    await ctx.plugin(CompactionEngine, {
      thresholdTokens: 200,
      thresholdTurns: 3,
      retainRecentTurns: 1,
    })

    mockAdapter = new MockLlmAdapter()
    ctx.llm.registerAdapter(['mock', 'default'], mockAdapter)
  })

  it('registers CompactionEngine on Context with expected default configs', () => {
    expect(ctx.compaction).toBeDefined()
    expect(ctx.compaction.config.thresholdTokens).toBe(200)
    expect(ctx.compaction.config.thresholdTurns).toBe(3)
    expect(ctx.compaction.config.retainRecentTurns).toBe(1)
  })

  it('protects tool-pairing boundaries with balanceToolPairingRange', () => {
    const session = ctx.sessions.create('test-pairing')
    session.append('turn/start', { turn: 1, trigger: { kind: 'message', source: 'user' } })
    session.append('user/message', { content: [{ type: 'text', text: 'Run tool' }] })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('tool/call', { turn: 1, step: 1, callId: 'call_1', name: 'bash', arguments: { command: 'ls' } })
    session.append('tool/result', { turn: 1, step: 1, callId: 'call_1', content: 'file1.txt' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    session.append('turn/start', { turn: 2, trigger: { kind: 'message', source: 'user' } })
    session.append('tool/call', { turn: 2, step: 1, callId: 'call_2', name: 'bash', arguments: { command: 'pwd' } })
    // call_2 has no tool/result yet

    const candidateSeqs = [0, 1, 2, 3, 4, 5, 6, 7, 8]
    const balanced = balanceToolPairingRange(session.events, candidateSeqs)

    // Seq 8 is call_2 without result; it must be pruned from candidateSeqs
    expect(balanced).not.toContain(8)
    // Seq 3 and 4 are call_1 and result_1; both remain
    expect(balanced).toContain(3)
    expect(balanced).toContain(4)
  })

  it('performs on-demand compactNow() and transforms deriveMessages() projection', async () => {
    const session = ctx.sessions.create('test-manual-compact')
    const agent = new ReactLoopAgent(ctx, 'agent-test', session)

    // Construct 3 turns of conversation
    // Turn 1
    session.append('turn/start', { turn: 1, trigger: { kind: 'message', source: 'user' } })
    session.append('user/message', { content: [{ type: 'text', text: 'Step 1: please inspect index.ts' }] })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'view_file', arguments: { path: 'index.ts' } })
    session.append('tool/result', { turn: 1, step: 1, callId: 'c1', content: 'export const hello = 1;' })
    session.append('assistant/message', { turn: 1, step: 1, content: [{ type: 'text', text: 'Inspected file.' }] })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    // Turn 2
    session.append('turn/start', { turn: 2, trigger: { kind: 'message', source: 'user' } })
    session.append('user/message', { content: [{ type: 'text', text: 'Step 2: add a test for hello' }] })
    session.append('step/start', { turn: 2, step: 1 })
    session.append('tool/call', { turn: 2, step: 1, callId: 'c2', name: 'bash', arguments: { command: 'pnpm test' } })
    session.append('tool/result', { turn: 2, step: 1, callId: 'c2', content: 'PASS test.spec.ts' })
    session.append('assistant/message', { turn: 2, step: 1, content: [{ type: 'text', text: 'Tests pass.' }] })
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

    // Turn 3 (Recent turn to be retained)
    session.append('turn/start', { turn: 3, trigger: { kind: 'message', source: 'user' } })
    session.append('user/message', { content: [{ type: 'text', text: 'Step 3: what is current status?' }] })
    session.append('step/start', { turn: 3, step: 1 })
    session.append('assistant/message', { turn: 3, step: 1, content: [{ type: 'text', text: 'Everything is ready.' }] })
    session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })

    const messagesBefore = session.deriveMessages()
    expect(messagesBefore.length).toBeGreaterThan(6)

    // Trigger compaction
    const result = await ctx.compaction.compactNow(agent)
    expect(result).not.toBeNull()
    expect(result?.compactionId).toMatch(/^cmp_/)
    expect(result?.shadowedSeqs.length).toBeGreaterThan(0)
    expect(result?.shadowedTokenCount).toBeGreaterThan(0)

    // Verify session events contains 3-stage lock events: start -> summary -> end
    const types = session.events.map((e) => e.type)
    expect(types).toContain('compaction/start')
    expect(types).toContain('compaction/summary')
    expect(types).toContain('compaction/end')

    // Verify deriveMessages() now replaces shadowed events with compaction summary
    const messagesAfter = session.deriveMessages()
    expect(messagesAfter.length).toBeLessThan(messagesBefore.length)

    // First message must be the compaction context summary
    const firstMsg = messagesAfter[0]
    expect(firstMsg.role).toBe('user')
    const firstContent = firstMsg.content[0] as any
    expect(firstContent.text).toContain('<context source="compaction">')

    // Recent Turn 3 messages must remain untouched
    const lastMsg = messagesAfter[messagesAfter.length - 1]
    expect(lastMsg.role).toBe('assistant')
    expect((lastMsg.content[0] as any).text).toBe('Everything is ready.')

    // Raw log preserves all original events
    expect(session.events.length).toBeGreaterThan(messagesBefore.length)
  })

  it('rejects concurrent compaction attempts on the same session', async () => {
    const session = ctx.sessions.create('test-lock')
    const agent = new ReactLoopAgent(ctx, 'agent-lock', session)

    // Append an open compaction/start without compaction/end
    session.append('compaction/start', { compactionId: 'open_lock', turn: 1 })

    await expect(ctx.compaction.compactRegion(agent, { start: 0, end: 1 })).rejects.toThrow(
      /正在执行另一个压缩事务/,
    )
  })

  it('intercepts /compact slash command and responds with confirmation', async () => {
    const session = ctx.sessions.create('test-slash-compact')
    const agent = new ReactLoopAgent(ctx, 'agent-slash', session)

    // Add some history
    for (let t = 1; t <= 3; t++) {
      session.append('turn/start', { turn: t, trigger: { kind: 'message', source: 'user' } })
      session.append('user/message', { content: [{ type: 'text', text: `Message for turn ${t}` }] })
      session.append('step/start', { turn: t, step: 1 })
      session.append('assistant/message', { turn: t, step: 1, content: [{ type: 'text', text: `Response ${t}` }] })
      session.append('turn/end', { turn: t, reason: { kind: 'completed' } })
    }

    // Send /compact command
    agent.send('/compact')
    await agent.whenIdle()

    const lastEvent = session.events[session.events.length - 1]
    expect(lastEvent.type).toBe('assistant/message')
    const text = (lastEvent.data as any).content[0].text
    expect(text).toContain('会话历史已成功压缩')
  })

  it('provides POST /api/sessions/:id/compact in WebServer', async () => {
    const webPort = 3928
    const server = new WebServer(ctx, { port: webPort, host: '127.0.0.1', workspaceDir: process.cwd() })
    await server.start()

    try {
      const ses = ctx.sessions.create('web-compact-session')
      // Populate history
      for (let t = 1; t <= 3; t++) {
        ses.append('turn/start', { turn: t, trigger: { kind: 'message', source: 'user' } })
        ses.append('user/message', { content: [{ type: 'text', text: `Web turn ${t}` }] })
        ses.append('step/start', { turn: t, step: 1 })
        ses.append('assistant/message', { turn: t, step: 1, content: [{ type: 'text', text: `Web reply ${t}` }] })
        ses.append('turn/end', { turn: t, reason: { kind: 'completed' } })
      }

      const res = await fetch(`http://127.0.0.1:${webPort}/api/sessions/web-compact-session/compact`, {
        method: 'POST',
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.status).toBe('compacted')
      expect(data.sessionId).toBe('web-compact-session')
      expect(data.result.compactionId).toBeDefined()
    } finally {
      await server.stop()
    }
  })

  it('triggers automatic compaction during agent runTurn when reaching pressure threshold', async () => {
    const session = ctx.sessions.create('test-auto-pressure')
    const agent = new ReactLoopAgent(ctx, 'agent-auto', session)

    // Pre-populate 3 turns of history
    for (let t = 1; t <= 3; t++) {
      session.append('turn/start', { turn: t, trigger: { kind: 'message', source: 'user' } })
      session.append('user/message', { content: [{ type: 'text', text: `Message ${t}` }] })
      session.append('step/start', { turn: t, step: 1 })
      session.append('assistant/message', { turn: t, step: 1, content: [{ type: 'text', text: `Response ${t}` }] })
      session.append('turn/end', { turn: t, reason: { kind: 'completed' } })
    }

    // Turn 4 reaches thresholdTurns: 3, triggering automatic compaction in pre-step
    agent.send('Turn 4 message')
    await agent.whenIdle()

    const types = session.events.map((e) => e.type)
    expect(types).toContain('compaction/start')
    expect(types).toContain('compaction/summary')
    expect(types).toContain('compaction/end')
  })
})
