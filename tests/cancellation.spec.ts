import { describe, it, expect } from 'vitest'
import { Context } from 'cordis'
import SessionStore from '../src/session/index.js'
import SystemPrompt from '../src/system-prompt/index.js'
import ToolRegistry from '../src/tools/index.js'
import LlmService from '../src/llm/index.js'
import { MockLlmAdapter } from '../src/llm/mock.js'
import AgentRegistry from '../src/agent/index.js'
import AgentLoop from '../src/agent-loop/index.js'

describe('Milestone 5: Graceful Task Cancellation', () => {
  it('aborts running turn and settles with aborted reason', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(LlmService)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop)

    ctx.llm.registerAdapter(['mock', 'default'], new MockLlmAdapter())

    // 注册一个模拟耗时工具
    ctx.tools.register({
      name: 'slow_tool',
      description: 'slow',
      parameters: { type: 'object', properties: {} },
      async execute() {
        await new Promise((r) => setTimeout(r, 100))
        return 'done'
      },
    })

    const agent = ctx.agentLoop.createAgent('cancel-agent', { model: 'mock' })

    agent.send('echo slow-task')
    // 立即取消
    agent.cancel('user clicked cancel button')
    await agent.whenIdle()

    const turnEnd = agent.session.events.find((e) => e.type === 'turn/end')
    expect(turnEnd).toBeDefined()
    expect(turnEnd?.data.reason.kind).toBe('aborted')
  })
})
