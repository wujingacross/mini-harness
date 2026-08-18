import { describe, it, expect } from 'vitest'
import { Context } from 'cordis'
import SessionStore from '../src/session/index.js'
import SystemPrompt from '../src/system-prompt/index.js'
import ToolRegistry from '../src/tools/index.js'
import LlmService from '../src/llm/index.js'
import { MockLlmAdapter } from '../src/llm/mock.js'
import AgentRegistry from '../src/agent/index.js'
import AgentLoop from '../src/agent-loop/index.js'

describe('Mini-Harness Milestone 1: ReAct Loop & Echo Tool', () => {
  it('should run a complete 2-step ReAct loop with tool call and result derivation', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(LlmService)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop)

    // Register adapter
    ctx.llm.registerAdapter(['mock', 'default'], new MockLlmAdapter())

    // Register echo tool
    let toolExecutionCount = 0
    ctx.tools.register({
      name: 'echo',
      description: 'Echoes back the message',
      parameters: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
      execute(args: { message: string }) {
        toolExecutionCount++
        return `ECHO: ${args.message}`
      },
    })

    // Create Agent
    const agent = ctx.agentLoop.createAgent('test-agent', { model: 'mock' })

    // Send user message that triggers tool
    agent.send('echo deepseek-harness')
    await agent.whenIdle()

    // Verification
    expect(toolExecutionCount).toBe(1)

    // Check Event Sourcing Log
    const events = agent.session.events
    const eventTypes = events.map(e => e.type)

    expect(eventTypes).toContain('turn/start')
    expect(eventTypes).toContain('user/message')
    expect(eventTypes).toContain('step/start')
    expect(eventTypes).toContain('assistant/chunk')
    expect(eventTypes).toContain('assistant/message')
    expect(eventTypes).toContain('tool/call')
    expect(eventTypes).toContain('tool/result')
    expect(eventTypes).toContain('turn/end')

    // Check derived messages
    const derived = agent.session.deriveMessages()
    expect(derived.length).toBeGreaterThanOrEqual(3)
    
    const lastMsg = derived[derived.length - 1]
    expect(lastMsg?.role).toBe('assistant')
    expect(lastMsg?.content[0]?.type).toBe('text')
  })
})
