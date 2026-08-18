import { Context, Service } from 'cordis'
import type { ToolSchema } from '../system-prompt/index.js'

export interface ToolDefinition<TArgs = any> {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  execute(args: TArgs): Promise<string> | string
}

export interface ToolExecution {
  callId: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolExecutionResult {
  content: string
  isError?: boolean
}

declare module 'cordis' {
  interface Context {
    tools: ToolRegistry
  }

  interface Events {
    'tools/execute'(this: ToolRegistry, exec: ToolExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult>
    'tools/change'(): void
  }
}

export class ToolRegistry extends Service {
  static inject = ['systemPrompt']
  private tools = new Map<string, ToolDefinition>()

  constructor(ctx: Context) {
    super(ctx, 'tools')

    // Automatically feed tool schemas into system prompt assembly
    this.ctx.systemPrompt.registerTools(() => this.schemas())
  }

  register(tool: ToolDefinition): () => void {
    this.tools.set(tool.name, tool)
    this.ctx.emit('tools/change')
    return () => {
      this.tools.delete(tool.name)
      this.ctx.emit('tools/change')
    }
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  schemas(): ToolSchema[] {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }))
  }

  async execute(exec: ToolExecution): Promise<ToolExecutionResult> {
    const tool = this.tools.get(exec.name)
    if (!tool) {
      return {
        content: `Error: Tool "${exec.name}" is not registered.`,
        isError: true,
      }
    }

    const defaultRunner = async (): Promise<ToolExecutionResult> => {
      try {
        const res = await tool.execute(exec.arguments)
        return { content: res, isError: false }
      } catch (err: any) {
        return { content: err?.message || String(err), isError: true }
      }
    }

    return await this.ctx.waterfall(this, 'tools/execute', exec, defaultRunner)
  }
}

export default ToolRegistry
