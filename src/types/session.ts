import type { ContentBlock } from './blocks.js'
import type { StreamChunk, TokenUsage } from './stream.js'

export type TurnTrigger =
  | { kind: 'message'; source: string }
  | { kind: 'continuation' }
  | { kind: 'injection'; source: string }

export type TurnEndReason =
  | { kind: 'completed' }
  | { kind: 'aborted'; reason?: string }
  | { kind: 'error'; step: number; message: string }
  | { kind: 'max-tokens' }

export interface SessionEventMap {
  'turn/start': { turn: number; trigger: TurnTrigger }
  'turn/end': { turn: number; reason: TurnEndReason }
  'step/start': { turn: number; step: number }
  'step/end': { turn: number; step: number }
  'user/message': { content: ContentBlock[]; source?: string }
  'context/message': { content: ContentBlock[]; source?: string }
  'assistant/chunk': { turn: number; step: number; chunk: StreamChunk }
  'assistant/message': { turn: number; step: number; content: ContentBlock[]; usage?: TokenUsage }
  'tool/call': { turn: number; step: number; callId: string; name: string; arguments: Record<string, unknown> }
  'tool/result': { turn: number; step: number; callId: string; content: string; isError?: boolean }
  'steering/message': { turn: number; content: ContentBlock[]; source?: string }
}

export type SessionEventType = keyof SessionEventMap

export type SessionEvent<K extends SessionEventType = SessionEventType> = {
  [T in SessionEventType]: {
    type: T
    seq: number
    time: number
    data: SessionEventMap[T]
  }
}[K]
