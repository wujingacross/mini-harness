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

/** 大模型统一网关与路由调度服务（基于适配器模式屏蔽不同模型实现） */
export class LlmService extends Service {
  /** 模型名称 ➔ 适配器实例映射表 */
  private adapters = new Map<string, LlmAdapter>()

  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  /** 注册模型适配器（支持多模型绑定），返回注销清理函数 */
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

  /** 统一流式生成入口：路由至对应适配器，通过 yield* 将分片数据透明转发给调用方 */
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const adapter = this.adapters.get(options.model)
    if (!adapter) {
      throw new Error(`No adapter registered for model "${options.model}"`)
    }

    // 生成器委托：原样转发适配器产生的每一个 StreamChunk
    yield* adapter.stream(options)
  }
}

export default LlmService
