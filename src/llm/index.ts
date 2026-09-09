import { Context, Service } from 'cordis'
import { LlmAdapter, type GenerateOptions } from './types.js'
import type { StreamChunk } from '../types/stream.js'

export * from './types.js'
export * from './mock.js'
export * from './deepseek.js'

declare module 'cordis' {
  interface Context {
    llm: LlmService
  }

  interface Events {
    'llm/stream'(options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>
  }
}

export class LlmService extends Service {
  private adapters = new Map<string, LlmAdapter>()
  private defaultAdapter?: LlmAdapter

  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  setDefaultAdapter(adapter: LlmAdapter): void {
    this.defaultAdapter = adapter
  }

  getDefaultAdapter(): LlmAdapter | undefined {
    return this.defaultAdapter
  }

  registerAdapter(models: string[], adapter: LlmAdapter): () => void {
    for (const model of models) {
      this.adapters.set(model, adapter)
    }
    return () => {
      for (const model of models) {
        this.adapters.delete(model)
      }
    }
  }

  listModels(): string[] {
    return Array.from(this.adapters.keys())
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const adapter = this.adapters.get(options.model) || this.defaultAdapter
    if (!adapter) {
      throw new Error(`No adapter registered for model "${options.model}". Registered models: [${Array.from(this.adapters.keys()).join(', ')}]`)
    }

    yield* adapter.stream(options)
  }
}

export default LlmService
