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

  // 3. 注册全局/平台级系统提示词（所有 Agent 实例共享的基础人设与规范）
  ctx.systemPrompt.section({
    name: 'core-identity',
    order: 0,
    text: 'You are an intelligent coding assistant built on the mini-harness framework.',
  })

  // 4. 挂载模型适配器（基于路由表绑定 mock 与 default 模型）
  const mockAdapter = new MockLlmAdapter()
  ctx.llm.registerAdapter(['mock', 'default'], mockAdapter)

  // 5. 注册业务工具（parameters 遵循大模型通用的标准 JSON Schema 规范）
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

  // 6. 创建 Agent 实例（分配独立的 Session 会话历史、状态机与专属实例级提示词）
  const agent = ctx.agentLoop.createAgent('echo-agent', {
    model: 'mock',
    systemPrompt: 'Keep responses crisp and helpful.',
  })

  // 7. 启动并绑定 Stdio 终端命令行交互界面
  attachStdioUI(ctx, agent)
}

main().catch(console.error)
