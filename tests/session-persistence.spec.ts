import { describe, it, expect, beforeEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { Context } from 'cordis'
import SessionStore from '../src/session/index.js'
import { JsonlSessionPersistence } from '../src/session-persistence/jsonl.js'
import { SqliteSessionPersistence } from '../src/session-persistence/sqlite.js'

const testDir = join(process.cwd(), '.tmp-test-sessions')

describe('Milestone 3: Session Persistence Seam & Backends Contract', () => {
  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
    await fs.mkdir(testDir, { recursive: true })
  })

  const backends = [
    {
      name: 'JSONL Backend',
      setup: async (ctx: Context) => {
        await ctx.plugin(JsonlSessionPersistence, { storageDir: testDir })
      },
    },
    {
      name: 'SQLite Backend',
      setup: async (ctx: Context) => {
        await ctx.plugin(SqliteSessionPersistence, { dbPath: join(testDir, 'test.db') })
      },
    },
  ]

  for (const { name, setup } of backends) {
    describe(name, () => {
      it('creates, appends, flushes, loads and lists sessions correctly', async () => {
        const ctx = new Context()
        await ctx.plugin(SessionStore)
        await setup(ctx)

        const session = ctx.sessions.create('ses-1', undefined, { cwd: '/test' })
        
        session.append('turn/start', { turn: 1, trigger: { kind: 'message', source: 'user' } })
        session.append('user/message', { content: [{ type: 'text', text: 'Hello persist' }] })
        session.append('assistant/message', { turn: 1, step: 1, content: [{ type: 'text', text: 'Hi!' }] })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

        // Trigger checkpoint flush
        await ctx.parallel('session/flush', session)

        // Load back
        const loaded = await ctx.sessionPersistence.load('ses-1')
        expect(loaded.header.id).toBe('ses-1')
        expect(loaded.events).toHaveLength(4)
        expect(loaded.events[0]?.type).toBe('turn/start')
        expect(loaded.events[3]?.type).toBe('turn/end')

        // List
        const list = await ctx.sessionPersistence.list()
        expect(list.some(s => s.id === 'ses-1')).toBe(true)
      })

      it('safely recovers and closes interrupted crashed turns on reload', async () => {
        const ctx = new Context()
        await ctx.plugin(SessionStore)
        await setup(ctx)

        const session = ctx.sessions.create('ses-crashed')
        
        // Simulate a crash mid-turn: assistant issued a tool call, but died before tool/result and turn/end
        session.append('turn/start', { turn: 1, trigger: { kind: 'message', source: 'user' } })
        session.append('user/message', { content: [{ type: 'text', text: 'Run command' }] })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('assistant/message', {
          turn: 1,
          step: 1,
          content: [{ type: 'tool-call', id: 'dangling-call-1', name: 'bash', arguments: { command: 'sleep 10' } }],
        })
        // CRASH OCCURS HERE! No tool/result, no step/end, no turn/end.

        await ctx.parallel('session/flush', session)

        // Reload the crashed session
        const loaded = await ctx.sessionPersistence.load('ses-crashed')
        const types = loaded.events.map(e => e.type)

        // Must have synthesized closers
        expect(types).toContain('tool/result')
        expect(types).toContain('step/end')
        expect(types).toContain('turn/end')

        const toolResult = loaded.events.find(e => e.type === 'tool/result')
        expect(toolResult?.data).toMatchObject({
          callId: 'dangling-call-1',
          isError: true,
        })

        const turnEnd = loaded.events.find(e => e.type === 'turn/end')
        expect(turnEnd?.data.reason).toMatchObject({
          kind: 'aborted',
        })
      })
    })
  }
})
