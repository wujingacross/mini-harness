import { join } from 'node:path'
import { Context } from 'cordis'
import SessionStore from '../session/index.js'
import SystemPrompt from '../system-prompt/index.js'
import ToolRegistry from '../tools/index.js'
import LlmService from '../llm/index.js'
import { DeepSeekAdapter } from '../llm/deepseek.js'
import BashService from '../bash/index.js'
import { createBashTool } from '../tools/bash.js'
import { createFileTools } from '../tools/file.js'
import { createSearchTools } from '../tools/search.js'
import { JsonlSessionPersistence } from '../session-persistence/jsonl.js'
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
  const storageDir = process.env.PERSISTENCE_DIR || join(process.cwd(), '.sessions')
  const resumeId = process.env.RESUME_SESSION_ID

  // 1. 初始化 Cordis 微内核容器
  const ctx = new Context()

  // 2. 加载核心服务插件
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(LlmService)
  await ctx.plugin(BashService, { defaultCwd: process.cwd() })
  await ctx.plugin(JsonlSessionPersistence, { storageDir })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop)

  // 3. 注册 Coding Agent 全局系统提示词
  ctx.systemPrompt.section({
    name: 'coding-identity',
    order: 0,
    text: `You are DeepSeek Code, an expert software engineering assistant built on the mini-harness framework.
You have access to a suite of professional developer tools:
- 'view_file': View file contents with line slicing and line numbers.
- 'replace_file_content': Precisely replace exact unique target code with new content.
- 'write_to_file': Create new files or overwrite existing files.
- 'find_by_name': Find files matching glob/pattern across the project.
- 'grep_search': Regex search for code and keywords across files.
- 'bash': Execute terminal commands, run tests, and check git status.

Guidelines:
1. Always prefer 'view_file' to inspect code before making modifications.
2. Prefer 'replace_file_content' for surgical edits and 'write_to_file' for new files.
3. Use 'grep_search' and 'find_by_name' to discover and explore project codebase efficiently.
4. Use 'bash' to verify your changes with actual build/test commands.
5. Provide concise, accurate, and direct responses.`,
  })

  // 4. 挂载真实 DeepSeek LLM 适配器
  const deepseekAdapter = new DeepSeekAdapter({ apiKey, baseURL })
  ctx.llm.registerAdapter([modelName, 'deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'], deepseekAdapter)

  // 5. 注册全套代码与命令工具
  const bashTool = createBashTool(ctx)
  ctx.tools.register(bashTool)

  for (const tool of createFileTools(ctx)) {
    ctx.tools.register(tool)
  }

  for (const tool of createSearchTools(ctx)) {
    ctx.tools.register(tool)
  }

  // 6. 创建或恢复 Coding Agent 实例
  let agent
  if (resumeId) {
    console.log(`\x1b[33m[Resume] Rehydrating persisted session: ${resumeId} ...\x1b[0m`)
    try {
      agent = await ctx.agentLoop.resumeAgent(resumeId, 'coding-agent', {
        model: modelName,
        systemPrompt: 'Be proactive and use the dedicated file/search/bash tools to solve tasks.',
      })
      console.log(`\x1b[32m[Resume] Successfully resumed session with ${agent.session.events.length} historical events.\x1b[0m`)
    } catch (err: any) {
      console.error(`\x1b[31m[Resume Error] Failed to load session ${resumeId}: ${err?.message || err}\x1b[0m`)
      console.log('Falling back to fresh session...')
      agent = ctx.agentLoop.createAgent('coding-agent', {
        model: modelName,
        systemPrompt: 'Be proactive and use the dedicated file/search/bash tools to solve tasks.',
      })
    }
  } else {
    agent = ctx.agentLoop.createAgent('coding-agent', {
      model: modelName,
      systemPrompt: 'Be proactive and use the dedicated file/search/bash tools to solve tasks.',
    })
  }

  console.log(`\x1b[36m=== DeepSeek Coding Agent Initialized ===\x1b[0m`)
  console.log(`\x1b[2mSession ID: ${agent.session.id} | Model: ${modelName} | Storage: ${storageDir}\x1b[0m\n`)

  // 7. 绑定终端交互
  attachStdioUI(ctx, agent)
}

main().catch(console.error)
