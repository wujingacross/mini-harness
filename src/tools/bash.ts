import type { Context } from 'cordis'
import type { ToolDefinition } from './index.js'

export interface BashToolArgs {
  command: string
  description?: string
  workdir?: string
  timeoutMs?: number
}

/**
 * 创建面向大模型的标准 bash 工具定义：
 * 赋予 Coding Agent 读写文件、搜索代码、执行测试与运行脚本的全部核心能力。
 */
export function createBashTool(ctx: Context): ToolDefinition<BashToolArgs> {
  return {
    name: 'bash',
    description: `Execute a bash command in a subprocess.
Use this tool to read/write files, search code (grep/find), run tests, and check git status.
Always specify 'workdir' if you need to run in a specific directory (avoid 'cd' commands across steps).`,
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The exact bash command line to execute.',
        },
        description: {
          type: 'string',
          description: 'A brief explanation of why you are running this command.',
        },
        workdir: {
          type: 'string',
          description: 'Optional working directory for the command.',
        },
        timeoutMs: {
          type: 'number',
          description: 'Optional timeout in milliseconds (default: 120000ms).',
        },
      },
      required: ['command'],
    },
    async execute(args: BashToolArgs) {
      if (!ctx.bash) {
        throw new Error('BashService (ctx.bash) is not registered')
      }

      const result = await ctx.bash.run({
        command: args.command,
        cwd: args.workdir,
        timeoutMs: args.timeoutMs,
      })

      // 格式化输出供模型消费
      let text = result.output.trim()
      if (!text && result.exitCode === 0) {
        text = '(command completed with no output)'
      }

      if (result.timedOut) {
        text += '\n[error: command timed out]'
      }

      if (result.exitCode !== 0 && result.exitCode !== null) {
        text += `\n[exit code: ${result.exitCode}]`
      }

      return text
    },
  }
}
