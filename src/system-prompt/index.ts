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

/** 拼接所有段落文本，若段落为函数则惰性求值 */
export function renderPrompt(assembly: PromptAssembly): string {
  return assembly.sections
    .map(s => typeof s.text === 'function' ? s.text() : s.text)
    .filter(t => t.trim().length > 0)
    .join('\n\n')
}

/** 微内核动态提示词与工具装配服务 */
export class SystemPrompt extends Service {
  private sections: PromptSection[] = []
  private toolProviders: (() => ToolSchema[])[] = []

  constructor(ctx: Context) {
    super(ctx, 'systemPrompt')
  }

  /** 动态注册提示词段落，按 order 升序排序，返回清理注销函数 */
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

  /** 注册工具元数据提供器（通常由 ToolRegistry 插件调用） */
  registerTools(provider: () => ToolSchema[]): () => void {
    this.toolProviders.push(provider)
    this.ctx.emit('system-prompt/change')
    return () => {
      const idx = this.toolProviders.indexOf(provider)
      if (idx >= 0) this.toolProviders.splice(idx, 1)
      this.ctx.emit('system-prompt/change')
    }
  }

  /** 装配提示词与工具，并通过 Cordis waterfall 责任链流水线允许中间件插件拦截/修改 */
  async assemble(_session?: Session): Promise<PromptAssembly> {
    const rawTools = this.toolProviders.flatMap(p => p())
    const initial: PromptAssembly = {
      sections: [...this.sections],
      tools: rawTools,
    }

    // 瀑布流拦截：允许外部插件（如权限控制、动态注入）在最后一步对 prompt 和 tools 进行改写
    return await this.ctx.waterfall(this, 'system-prompt/assemble', initial, () => Promise.resolve(initial))
  }
}

export default SystemPrompt
