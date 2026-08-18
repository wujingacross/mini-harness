import { Context, Service } from 'cordis'
import { LlmAdapter, type GenerateOptions } from './types.js'
import type { StreamChunk } from '../types/stream.js'

export * from './types.js'
export * from './mock.js'

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

  constructor(ctx: Context) {
    super(ctx, 'llm')
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

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const adapter = this.adapters.get(options.model)
    if (!adapter) {
      throw new Error(`No adapter registered for model "${options.model}"`)
    }

    // Yield from adapter stream
    yield* adapter.stream(options)
  }
}

export default LlmService
