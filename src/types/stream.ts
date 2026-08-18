import type { ContentBlock, Message, ReasoningBlock, TextBlock, ToolCallBlock } from './blocks.js'

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export type FinishReason =
  | { kind: 'stop' }
  | { kind: 'tool-use' }
  | { kind: 'length' }
  | { kind: 'error'; message: string }

export type StreamChunk =
  | { type: 'block-start'; index: number; blockType: string }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: string; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: ContentBlock }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: FinishReason }

interface PartialBlock {
  blockType: string
  text: string
  toolCallId?: string
  toolCallName?: string
  toolCallArguments: string
  block?: ContentBlock
}

/**
 * Incrementally assembles raw StreamChunks into complete ContentBlocks and Message.
 */
export class BlockAssembler {
  private partials = new Map<number, PartialBlock>()
  private order: number[] = []
  private _usage: TokenUsage | undefined
  private _finish: FinishReason | undefined

  push(chunk: StreamChunk): ContentBlock | undefined {
    switch (chunk.type) {
      case 'block-start': {
        if (!this.partials.has(chunk.index)) {
          this.order.push(chunk.index)
          this.partials.set(chunk.index, {
            blockType: chunk.blockType,
            text: '',
            toolCallArguments: '',
          })
        }
        return
      }
      case 'text-delta':
      case 'reasoning-delta': {
        const partial = this.ensure(chunk.index, chunk.type === 'text-delta' ? 'text' : 'reasoning')
        if (partial.block) return
        partial.text += chunk.text
        return
      }
      case 'tool-call-delta': {
        const partial = this.ensure(chunk.index, 'tool-call')
        if (partial.block) return
        partial.toolCallId = chunk.id
        if (chunk.name) partial.toolCallName = chunk.name
        partial.toolCallArguments += chunk.argumentsDelta
        return
      }
      case 'block-end': {
        const partial = this.ensure(chunk.index, chunk.block.type)
        if (partial.block) return
        partial.block = chunk.block
        return chunk.block
      }
      case 'usage': {
        this._usage = chunk.usage
        return
      }
      case 'finish': {
        this._finish = chunk.reason
        return
      }
    }
  }

  private ensure(index: number, blockType: string): PartialBlock {
    let partial = this.partials.get(index)
    if (!partial) {
      partial = { blockType, text: '', toolCallArguments: '' }
      this.partials.set(index, partial)
      this.order.push(index)
    }
    return partial
  }

  get usage(): TokenUsage | undefined {
    return this._usage
  }

  get finish(): FinishReason | undefined {
    return this._finish
  }

  blocks(): ContentBlock[] {
    const result: ContentBlock[] = []
    for (const index of this.order) {
      const p = this.partials.get(index)
      if (!p) continue
      if (p.block) {
        result.push(p.block)
        continue
      }
      if (p.blockType === 'text') {
        result.push({ type: 'text', text: p.text } as TextBlock)
      } else if (p.blockType === 'reasoning') {
        result.push({ type: 'reasoning', text: p.text } as ReasoningBlock)
      } else if (p.blockType === 'tool-call') {
        let args: Record<string, unknown> = {}
        try {
          args = p.toolCallArguments ? JSON.parse(p.toolCallArguments) : {}
        } catch {
          args = { _raw: p.toolCallArguments }
        }
        result.push({
          type: 'tool-call',
          id: p.toolCallId ?? `call_${index}`,
          name: p.toolCallName ?? 'unknown',
          arguments: args,
        } as ToolCallBlock)
      }
    }
    return result
  }

  message(): Message {
    return {
      role: 'assistant',
      content: this.blocks(),
    }
  }
}
