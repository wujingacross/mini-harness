import { describe, it, expect } from 'vitest'
import { Context } from 'cordis'
import SessionStore from '../src/session/index.js'
import SystemPrompt from '../src/system-prompt/index.js'
import ToolRegistry from '../src/tools/index.js'
import LlmService from '../src/llm/index.js'
import { MockLlmAdapter } from '../src/llm/mock.js'
import AgentRegistry from '../src/agent/index.js'
import AgentLoop from '../src/agent-loop/index.js'

describe('Milestone 5: Mid-turn Steering & Course Correction', () => {
  it('correctly appends steering/message and projects into derived messages', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(LlmService)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop)

    ctx.llm.registerAdapter(['mock', 'default'], new MockLlmAdapter())

    const agent = ctx.agentLoop.createAgent('steering-agent', { model: 'mock' })

    // Simulate steering intervention
    agent.session.append('turn/start', { turn: 1, trigger: { kind: 'message', source: 'user' } })
    agent.session.append('user/message', { content: [{ type: 'text', text: 'Original task' }] })
    agent.session.append('steering/message', {
      turn: 1,
      content: [{ type: 'text', text: 'Wait! Don not edit file A, edit file B instead' }],
      source: 'user',
    })

    const messages = agent.session.deriveMessages()
    expect(messages).toHaveLength(2)
    expect(messages[1]?.role).toBe('user')

    const steeringText = messages[1]?.content.map((b: any) => b.text).join('')
    expect(steeringText).toContain('<steering source="user">')
    expect(steeringText).toContain('edit file B instead')
    expect(steeringText).toContain('</steering>')
  })
})
