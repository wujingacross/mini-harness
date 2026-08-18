/**
 * Content block definitions.
 * Messages in deepseek-harness are arrays of typed content blocks.
 */

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ReasoningBlock {
  type: 'reasoning'
  text: string
  signature?: string
}

export interface ToolCallBlock {
  type: 'tool-call'
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResultBlock {
  type: 'tool-result'
  toolCallId: string
  content: string
  isError?: boolean
}

export type ContentBlock =
  | TextBlock
  | ReasoningBlock
  | ToolCallBlock
  | ToolResultBlock

export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: ContentBlock[]
}
