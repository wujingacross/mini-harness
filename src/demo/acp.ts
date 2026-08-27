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
import { AcpBridge } from '../acp/bridge.js'

// 尝试加载根目录 .env (调试日志一律输出到 stderr，切勿污染 stdout JSON-RPC 管道)
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
    console.error('[ACP Server Error] DEEPSEEK_API_KEY is not set!')
    process.exit(1)
  }

  const baseURL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  const modelName = process.env.DEEPSEEK_MODEL || 'deepseek-chat'
  const storageDir = process.env.PERSISTENCE_DIR || join(process.cwd(), '.sessions')

  // 1. 初始化 Cordis 微内核容器
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

  // 3. 注册 Coding Agent 全局系统提示词
  ctx.systemPrompt.section({
    name: 'coding-identity',
    order: 0,
    text: `You are DeepSeek Code running as an ACP (Agent Client Protocol) server inside the user's IDE.
You have access to professional tools:
- 'view_file': View file contents with line slicing and line numbers.
- 'replace_file_content': Precisely replace exact unique target code with new content.
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

  // 6. 加载并启动 ACP 桥接网关 (绑定 process.stdin 与 process.stdout)
  await ctx.plugin(AcpBridge, {
    model: modelName,
    serverName: 'mini-harness-acp',
    serverVersion: '1.1.0',
    input: process.stdin,
    output: process.stdout,
  })

  console.error(`[ACP Server] DeepSeek ACP Server running on stdio (PID: ${process.pid})`)
}

main().catch((err) => {
  console.error('[ACP Server Fatal Error]:', err)
  process.exit(1)
})
