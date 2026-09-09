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
    let adapter = this.adapters.get(options.model)
    if (!adapter) {
      if (options.model.startsWith('glm') || options.model.startsWith('chatglm')) {
        throw new Error(`检测到您请求了智谱 GLM 模型 "${options.model}"，但环境变量中未配置有效的 GLM_API_KEY 或 ZHIPU_API_KEY。请在 .env 中配置 GLM_API_KEY=your_key 后重启服务。`)
      }
      if (options.model.startsWith('qwen')) {
        throw new Error(`检测到您请求了阿里通义千问模型 "${options.model}"，但环境变量中未配置有效的 DASHSCOPE_API_KEY 或 QWEN_API_KEY。请在 .env 中配置 DASHSCOPE_API_KEY=your_key 后重启服务。`)
      }
      if (options.model.startsWith('gpt') || options.model.startsWith('o1')) {
        throw new Error(`检测到您请求了 OpenAI 模型 "${options.model}"，但环境变量中未配置有效的 OPENAI_API_KEY。请在 .env 中配置 OPENAI_API_KEY=your_key 后重启服务。`)
      }
      adapter = this.defaultAdapter
    }
    if (!adapter) {
      throw new Error(`No adapter registered for model "${options.model}". Registered models: [${Array.from(this.adapters.keys()).join(', ')}]`)
    }

    yield* adapter.stream(options)
  }
}

export default LlmService
