import { LlmAdapter, type GenerateOptions } from './types.js'
import type { StreamChunk, TokenUsage, FinishReason } from '../types/stream.js'
import type { Message, ContentBlock } from '../types/blocks.js'

export interface DeepSeekAdapterOptions {
  apiKey: string
  baseURL?: string
}

interface WireToolCall {
  index: number
  id?: string
  function?: {
    name?: string
    arguments?: string
  }
}

interface WireChunkChoice {
  index: number
  delta?: {
    role?: string
    content?: string | null
    reasoning_content?: string | null
    tool_calls?: WireToolCall[]
  }
  finish_reason?: string | null
}

interface WireChunk {
  choices?: WireChunkChoice[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

/**
 * 真实 DeepSeek API 流式适配器：
 * 1. 原生支持 DeepSeek-R1 / DeepSeek-V3 推理与代码模型（含 reasoning_content 深度思考流与 content 回复流）；
 * 2. 支持 Function Calling 多工具调用流式切片拼装与参数增量下发；
 * 3. 严格解析 Server-Sent Events (SSE) 协议、Token Usage 统计与 [DONE] 终止符；
 * 4. 完整的网络异常转换与 AbortSignal 取消传递。
 */
export class DeepSeekAdapter extends LlmAdapter {
  private apiKey: string
  private baseURL: string

  constructor(options: DeepSeekAdapterOptions) {
    super()
    this.apiKey = options.apiKey
    this.baseURL = (options.baseURL || 'https://api.deepseek.com').replace(/\/+$/, '')
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const wireMessages = this.serializeMessages(options.systemPrompt, options.messages)
    const wireTools = options.tools?.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))

    const payload: Record<string, unknown> = {
      model: options.model,
      messages: wireMessages,
      stream: true,
      stream_options: { include_usage: true },
    }

    if (wireTools && wireTools.length > 0) {
      payload.tools = wireTools
    }

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(payload),
      signal: options.signal,
    })

    if (!response.ok) {
      let errText = `DeepSeek API HTTP Error: ${response.status} ${response.statusText}`
      try {
        const json = await response.json()
        if (json?.error?.message) {
          errText = `DeepSeek API Error: ${json.error.message}`
        }
      } catch {
        // ignore JSON parse error
      }
      throw new Error(errText)
    }

    if (!response.body) {
      throw new Error('DeepSeek API returned empty response body')
    }

    yield* this.parseAndTranslateSSE(response.body)
  }

  private serializeMessages(systemPrompt?: string, messages: Message[] = []): any[] {
    const wire: any[] = []

    if (systemPrompt && systemPrompt.trim().length > 0) {
      wire.push({ role: 'system', content: systemPrompt })
    }

    for (const msg of messages) {
      if (msg.role === 'user') {
        // Check for tool results
        const toolResults = msg.content.filter((b) => b.type === 'tool-result')
        if (toolResults.length > 0) {
          for (const tr of toolResults) {
            if (tr.type === 'tool-result') {
              wire.push({
                role: 'tool',
                tool_call_id: tr.toolCallId,
                content: tr.content,
              })
            }
          }
        } else {
          // Normal user text content
          const text = msg.content
            .filter((b) => b.type === 'text')
            .map((b: any) => b.text)
            .join('\n')
          wire.push({ role: 'user', content: text })
        }
      } else if (msg.role === 'assistant') {
        const textBlocks = msg.content.filter((b) => b.type === 'text')
        const toolCalls = msg.content.filter((b) => b.type === 'tool-call')

        const content = textBlocks.map((b: any) => b.text).join('\n') || null
        const wireToolCalls = toolCalls.map((tc: any) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments || {}),
          },
        }))

        wire.push({
          role: 'assistant',
          content,
          ...(wireToolCalls.length > 0 ? { tool_calls: wireToolCalls } : {}),
        })
      }
    }

    return wire
  }

  private async *parseAndTranslateSSE(
    body: ReadableStream<Uint8Array>,
  ): AsyncGenerator<StreamChunk> {
    const reader = body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    let nextBlockIndex = 0
    let reasoningBlockIndex: number | null = null
    let textBlockIndex: number | null = null
    const toolCallIndices = new Map<number, { blockIndex: number; id: string; name: string }>()

    let finishReason: FinishReason | undefined
    let usageInfo: TokenUsage | undefined

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const rawLine of lines) {
          const line = rawLine.trim()
          if (!line || line.startsWith(':')) continue // skip empty and comments

          if (line.startsWith('data:')) {
            const dataStr = line.slice(5).trim()
            if (dataStr === '[DONE]') {
              break
            }

            let parsed: WireChunk
            try {
              parsed = JSON.parse(dataStr)
            } catch {
              continue // skip malformed JSON chunk
            }

            if (parsed.usage) {
              usageInfo = {
                promptTokens: parsed.usage.prompt_tokens,
                completionTokens: parsed.usage.completion_tokens,
                totalTokens: parsed.usage.total_tokens,
              }
            }

            const choice = parsed.choices?.[0]
            if (!choice) continue

            if (choice.finish_reason) {
              if (choice.finish_reason === 'stop') {
                finishReason = { kind: 'stop' }
              } else if (choice.finish_reason === 'tool_calls') {
                finishReason = { kind: 'tool-use' }
              } else if (choice.finish_reason === 'length') {
                finishReason = { kind: 'length' }
              } else {
                finishReason = { kind: 'stop' }
              }
            }

            const delta = choice.delta
            if (!delta) continue

            // 1. Handle DeepSeek Reasoning / CoT Stream
            if (delta.reasoning_content) {
              if (reasoningBlockIndex === null) {
                reasoningBlockIndex = nextBlockIndex++
                yield { type: 'block-start', index: reasoningBlockIndex, blockType: 'reasoning' }
              }
              yield {
                type: 'reasoning-delta',
                index: reasoningBlockIndex,
                text: delta.reasoning_content,
              }
            }

            // 2. Handle Text Content Stream
            if (delta.content) {
              if (textBlockIndex === null) {
                textBlockIndex = nextBlockIndex++
                yield { type: 'block-start', index: textBlockIndex, blockType: 'text' }
              }
              yield {
                type: 'text-delta',
                index: textBlockIndex,
                text: delta.content,
              }
            }

            // 3. Handle Tool Calls Stream
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                let entry = toolCallIndices.get(tc.index)
                if (!entry) {
                  const bIndex = nextBlockIndex++
                  entry = {
                    blockIndex: bIndex,
                    id: tc.id || `call_${Date.now()}_${tc.index}`,
                    name: tc.function?.name || '',
                  }
                  toolCallIndices.set(tc.index, entry)
                  yield { type: 'block-start', index: bIndex, blockType: 'tool-call' }
                }

                if (tc.function?.name && !entry.name) {
                  entry.name = tc.function.name
                }
                if (tc.id && !entry.id) {
                  entry.id = tc.id
                }

                const argsDelta = tc.function?.arguments || ''
                yield {
                  type: 'tool-call-delta',
                  index: entry.blockIndex,
                  id: entry.id,
                  name: entry.name,
                  argumentsDelta: argsDelta,
                }
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    if (usageInfo) {
      yield { type: 'usage', usage: usageInfo }
    }

    yield { type: 'finish', reason: finishReason ?? { kind: 'stop' } }
  }
}
