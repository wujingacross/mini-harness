import type { Message } from '../types/blocks.js'
import type { StreamChunk } from '../types/stream.js'
import type { ToolSchema } from '../system-prompt/index.js'

export interface GenerateOptions {
  model: string
  systemPrompt?: string
  messages: Message[]
  tools?: ToolSchema[]
  signal?: AbortSignal
}

export abstract class LlmAdapter {
  abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}
