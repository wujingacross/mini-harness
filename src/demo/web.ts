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
import WebServer from '../web/index.js'

// 加载 .env
try {
  if (typeof (process as any).loadEnvFile === 'function') {
    ;(process as any).loadEnvFile()
  }
} catch {
  // ignore
}

async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    console.error('\x1b[31m[Error] DEEPSEEK_API_KEY is not set!\x1b[0m')
    console.error('Please export DEEPSEEK_API_KEY=sk-... or provide it in .env\n')
    process.exit(1)
  }

  const port = Number(process.env.PORT || 3000)
  const host = process.env.HOST || '127.0.0.1'
  const baseURL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  const modelName = process.env.DEEPSEEK_MODEL || 'deepseek-chat'
  const storageDir = process.env.PERSISTENCE_DIR || join(process.cwd(), '.sessions')

  // 1. 初始化 Cordis 容器
  const ctx = new Context()

  // 2. 加载核心能力插件
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(LlmService)
  await ctx.plugin(BashService, { defaultCwd: process.cwd() })
  await ctx.plugin(JsonlSessionPersistence, { storageDir })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop)

  // 3. 注册系统提示词
  ctx.systemPrompt.section({
    name: 'coding-identity',
    order: 0,
    text: `You are DeepSeek Code running inside the Mini-Harness Web Dashboard.
You have access to professional tools:
- 'view_file': Inspect files with line slicing.
- 'replace_file_content': Surgically replace unique target code.
- 'write_to_file': Create new files or overwrite existing files.
- 'find_by_name': Find files matching glob/pattern across the project.
- 'grep_search': Regex search for code and keywords across files.
- 'bash': Execute terminal commands and run tests.

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

  // 5. 注册本地 Bash、文件读写与搜索工具
  const bashTool = createBashTool(ctx)
  ctx.tools.register(bashTool)

  for (const tool of createFileTools(ctx)) {
    ctx.tools.register(tool)
  }

  for (const tool of createSearchTools(ctx)) {
    ctx.tools.register(tool)
  }

  // 6. 加载并启动 Web Server
  await ctx.plugin(WebServer, {
    port,
    host,
    workspaceDir: process.cwd(),
    model: modelName,
  })

  const serverUrl = await ctx.webServer.start()

  console.log(`\n\x1b[36m┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\x1b[0m`)
  console.log(`\x1b[36m┃\x1b[0m   \x1b[32m🚀 DeepSeek Mini-Harness Web Dashboard is Live!\x1b[0m           \x1b[36m┃\x1b[0m`)
  console.log(`\x1b[36m┃\x1b[0m   \x1b[1mURL:\x1b[0m  \x1b[34m\x1b[4m${serverUrl}\x1b[0m                                \x1b[36m┃\x1b[0m`)
  console.log(`\x1b[36m┃\x1b[0m   \x1b[2mModel:\x1b[0m \x1b[33m${modelName}\x1b[0m | \x1b[2mStorage:\x1b[0m ${storageDir}              \x1b[36m┃\x1b[0m`)
  console.log(`\x1b[36m┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\x1b[0m\n`)
  console.log(`Open \x1b[34m${serverUrl}\x1b[0m in your browser to start chatting with the agent!\n`)
}

main().catch(console.error)
