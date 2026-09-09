import { join } from 'node:path'
import { Context } from 'cordis'
import SessionStore from '../session/index.js'
import SystemPrompt from '../system-prompt/index.js'
import ToolRegistry from '../tools/index.js'
import LlmService from '../llm/index.js'
import { DeepSeekAdapter, OpenAiCompatibleAdapter } from '../llm/deepseek.js'
import BashService from '../bash/index.js'
import { createBashTool } from '../tools/bash.js'
import { createFileTools } from '../tools/file.js'
import { createSearchTools } from '../tools/search.js'
import { JsonlSessionPersistence } from '../session-persistence/jsonl.js'
import AgentRegistry from '../agent/index.js'
import AgentLoop from '../agent-loop/index.js'
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
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
  const distIndex = join(process.cwd(), 'web/dist/index.html')
  if (!existsSync(distIndex)) {
    console.log('\x1b[33m[Build] Building React frontend bundle with Vite...\x1b[0m')
    execSync('pnpm run build:web', { stdio: 'inherit' })
  }

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
Your workspace root directory is ${process.cwd()} (the real host directory).
Do NOT assume you are in a Docker container or invent fictitious paths like '/workspace'.

Guidelines & Tool Priorities:
1. EXPLORATION PRIORITY: When asked to explore files or codebase structure, ALWAYS use dedicated tools:
   - Use 'find_by_name' to discover files matching globs/patterns.
   - Use 'grep_search' to search for symbols, functions, or text across the project.
   - Use 'view_file' to inspect file content with precise line slicing.
   DO NOT call 'bash' for 'ls', 'find', or 'cat' when dedicated file tools are available!
2. EDITING: Prefer 'replace_file_content' for surgical edits and 'write_to_file' for new files.
3. BASH EXECUTION: Use 'bash' ONLY for running test suites, build commands, package managers (pnpm/npm), and git commands.
4. Provide concise, accurate, and direct responses.`,
  })

  // 4. 挂载真实 LLM 适配器体系 (支持 DeepSeek、智谱 GLM、阿里通义千问 Qwen、OpenAI、本地 Ollama)
  const deepseekAdapter = new DeepSeekAdapter({ apiKey, baseURL })
  ctx.llm.registerAdapter([modelName, 'deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'], deepseekAdapter)
  ctx.llm.setDefaultAdapter(deepseekAdapter)

  // 可选加载 智谱 GLM (BigModel)
  const glmKey = process.env.GLM_API_KEY || process.env.ZHIPU_API_KEY
  if (glmKey) {
    const glmBase = process.env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4'
    const glmAdapter = new OpenAiCompatibleAdapter({ apiKey: glmKey, baseURL: glmBase })
    ctx.llm.registerAdapter(['glm-4-flash', 'glm-4-plus', 'glm-4-air', 'glm-4-long', 'glm-4-0520'], glmAdapter)
  }

  // 可选加载 阿里通义千问 Qwen (DashScope)
  const qwenKey = process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY
  if (qwenKey) {
    const qwenBase = process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    const qwenAdapter = new OpenAiCompatibleAdapter({ apiKey: qwenKey, baseURL: qwenBase })
    ctx.llm.registerAdapter(['qwen-plus', 'qwen-turbo', 'qwen-coder-plus', 'qwen-max'], qwenAdapter)
  }

  // 可选加载 OpenAI 官方或中转
  const openaiKey = process.env.OPENAI_API_KEY
  if (openaiKey) {
    const openaiBase = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
    const openaiAdapter = new OpenAiCompatibleAdapter({ apiKey: openaiKey, baseURL: openaiBase })
    ctx.llm.registerAdapter(['gpt-4o', 'gpt-4o-mini', 'o1-mini'], openaiAdapter)
  }

  // 可选加载 本地 Ollama / vLLM
  const ollamaBase = process.env.OLLAMA_BASE_URL
  if (ollamaBase) {
    const ollamaAdapter = new OpenAiCompatibleAdapter({ apiKey: 'ollama', baseURL: ollamaBase })
    ctx.llm.registerAdapter(['qwen2.5-coder:7b', 'deepseek-r1:8b', 'llama3.1:8b'], ollamaAdapter)
  }

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
