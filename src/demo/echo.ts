import { Context } from 'cordis'
import SessionStore from '../session/index.js'
import SystemPrompt from '../system-prompt/index.js'
import ToolRegistry from '../tools/index.js'
import LlmService from '../llm/index.js'
import { MockLlmAdapter } from '../llm/mock.js'
import AgentRegistry from '../agent/index.js'
import AgentLoop from '../agent-loop/index.js'
import { attachStdioUI } from '../ui/stdio.js'

async function main() {
  // 1. Initialize Microkernel Container
  const ctx = new Context()

  // 2. Load Core Services (Plugins)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(LlmService)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop)

  // 3. Register System Prompt Sections
  ctx.systemPrompt.section({
    name: 'core-identity',
    order: 0,
    text: 'You are an intelligent coding assistant built on the mini-harness framework.',
  })

  // 4. Register LLM Adapter
  const mockAdapter = new MockLlmAdapter()
  ctx.llm.registerAdapter(['mock', 'default'], mockAdapter)

  // 5. Register Echo Tool
  ctx.tools.register({
    name: 'echo',
    description: 'Echo back the input message with formatting',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The text message to echo' },
      },
      required: ['message'],
    },
    execute(args: { message: string }) {
      return `[ECHO-TOOL-OUTPUT]: ${args.message.toUpperCase()}`
    },
  })

  // 6. Create Agent Instance
  const agent = ctx.agentLoop.createAgent('echo-agent', {
    model: 'mock',
    systemPrompt: 'Keep responses crisp and helpful.',
  })

  // 7. Attach Stdio CLI
  attachStdioUI(ctx, agent)
}

main().catch(console.error)
