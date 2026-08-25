import { describe, it, expect } from 'vitest'
import { Context } from 'cordis'
import SessionStore from '../src/session/index.js'
import { applyInvariants, InvariantError } from '../src/invariants/index.js'

describe('Milestone 5: Invariants Guard & Immutability', () => {
  it('deep-freezes logged events and prevents silent mutation', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    applyInvariants(ctx, { freeze: true })

    const session = ctx.sessions.create('ses-inv-1')
    const event = session.append('turn/start', { turn: 1, trigger: { kind: 'message', source: 'user' } })

    // Attempt to mutate frozen event properties -> should throw in strict mode
    expect(() => {
      ;(event as any).type = 'mutated'
    }).toThrow()

    expect(() => {
      ;(event.data as any).turn = 999
    }).toThrow()
  })

  it('rejects sequence gaps or duplicate seqs with InvariantError', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    applyInvariants(ctx)

    const session = ctx.sessions.create('ses-inv-2')
    session.append('turn/start', { turn: 1, trigger: { kind: 'message', source: 'user' } })

    // Manually push corrupted event to trigger session/event with invalid seq
    expect(() => {
      ;(ctx as any).emit('session/event', session, {
        type: 'user/message',
        seq: 5, // Gap: expected 1, got 5!
        time: Date.now(),
        data: { content: [{ type: 'text', text: 'gap' }] },
      })
    }).toThrow(InvariantError)
  })

  it('rejects opening a new turn when another turn is already open', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    applyInvariants(ctx)

    const session = ctx.sessions.create('ses-inv-3')
    session.append('turn/start', { turn: 1, trigger: { kind: 'message', source: 'user' } })

    // Trying to start Turn 2 without closing Turn 1
    expect(() => {
      session.append('turn/start', { turn: 2, trigger: { kind: 'message', source: 'user' } })
    }).toThrow(InvariantError)
  })
})
