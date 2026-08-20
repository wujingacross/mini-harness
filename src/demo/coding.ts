import { Context } from 'cordis'
import SessionStore from '../session/index.js'
import SystemPrompt from '../system-prompt/index.js'
import ToolRegistry from '../tools/index.js'
import LlmService from '../llm/index.js'
import { DeepSeekAdapter } from '../llm/deepseek.js'
import BashService from '../bash/index.js'
import { createBashTool } from '../tools/bash.js'
import AgentRegistry from '../agent/index.js'
import AgentLoop from '../agent-loop/index.js'
import { attachStdioUI } from '../ui/stdio.js'

// 优先尝试通过 Node 原生 loadEnvFile 加载根目录 .env
try {
  if (typeof (process as any).loadEnvFile === 'function') {
    ;(process as any).loadEnvFile()
  }
} catch {
  // .env not found or already loaded
}

async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    console.error('\x1b[31m[Error] DEEPSEEK_API_KEY environment variable is not set!\x1b[0m')
    console.error('Please export DEEPSEEK_API_KEY=sk-... or create a .env file with DEEPSEEK_API_KEY=sk-...\n')
    process.exit(1)
  }

  const baseURL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  const modelName = process.env.DEEPSEEK_MODEL || 'deepseek-chat'

  // 1. 初始化 Cordis 微内核容器
  const ctx = new Context()

  // 2. 加载核心服务插件
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(LlmService)
  await ctx.plugin(BashService, { defaultCwd: process.cwd() })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop)

  // 3. 注册 Coding Agent 全局系统提示词
  ctx.systemPrompt.section({
    name: 'coding-identity',
    order: 0,
    text: `You are DeepSeek Code, an expert coding assistant built on the mini-harness framework.
You have access to a powerful 'bash' tool to inspect files, edit code, search directory contents, and run tests.

Guidelines:
1. Always prefer using the 'bash' tool to explore the filesystem and verify your work directly.
2. Specify 'workdir' when executing commands in subdirectories instead of relying on 'cd'.
3. Provide concise, direct answers and confirm file modifications with actual test/build runs.`,
  })

  // 4. 挂载真实 DeepSeek LLM 适配器
  const deepseekAdapter = new DeepSeekAdapter({ apiKey, baseURL })
  ctx.llm.registerAdapter([modelName, 'deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'], deepseekAdapter)

  // 5. 注册本地 Bash 工具
  const bashTool = createBashTool(ctx)
  ctx.tools.register(bashTool)

  // 6. 创建 Coding Agent 实例
  const agent = ctx.agentLoop.createAgent('coding-agent', {
    model: modelName,
    systemPrompt: 'Be proactive and use the bash tool to solve the user tasks.',
  })

  console.log(`\x1b[36m=== DeepSeek Coding Agent Initialized ===\x1b[0m`)
  console.log(`\x1b[2mModel: ${modelName} | BaseURL: ${baseURL}\x1b[0m\n`)

  // 7. 绑定终端交互
  attachStdioUI(ctx, agent)
}

main().catch(console.error)
