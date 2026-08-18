import { Context, Service } from 'cordis'
import type { Session } from '../session/index.js'

export interface ToolSchema {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export interface PromptSection {
  name: string
  order: number
  text: string | (() => string)
}

export interface PromptAssembly {
  sections: PromptSection[]
  tools: ToolSchema[]
}

declare module 'cordis' {
  interface Context {
    systemPrompt: SystemPrompt
  }

  interface Events {
    'system-prompt/assemble'(this: SystemPrompt, assembly: PromptAssembly, next: () => Promise<PromptAssembly>): Promise<PromptAssembly>
    'system-prompt/change'(): void
  }
}

export function renderPrompt(assembly: PromptAssembly): string {
  return assembly.sections
    .map(s => typeof s.text === 'function' ? s.text() : s.text)
    .filter(t => t.trim().length > 0)
    .join('\n\n')
}

export class SystemPrompt extends Service {
  private sections: PromptSection[] = []
  private toolProviders: (() => ToolSchema[])[] = []

  constructor(ctx: Context) {
    super(ctx, 'systemPrompt')
  }

  section(section: PromptSection): () => void {
    this.sections.push(section)
    this.sections.sort((a, b) => a.order - b.order)
    this.ctx.emit('system-prompt/change')
    return () => {
      const idx = this.sections.indexOf(section)
      if (idx >= 0) this.sections.splice(idx, 1)
      this.ctx.emit('system-prompt/change')
    }
  }

  registerTools(provider: () => ToolSchema[]): () => void {
    this.toolProviders.push(provider)
    this.ctx.emit('system-prompt/change')
    return () => {
      const idx = this.toolProviders.indexOf(provider)
      if (idx >= 0) this.toolProviders.splice(idx, 1)
      this.ctx.emit('system-prompt/change')
    }
  }

  async assemble(_session?: Session): Promise<PromptAssembly> {
    const rawTools = this.toolProviders.flatMap(p => p())
    const initial: PromptAssembly = {
      sections: [...this.sections],
      tools: rawTools,
    }

    return await this.ctx.waterfall(this, 'system-prompt/assemble', initial, () => Promise.resolve(initial))
  }
}

export default SystemPrompt
