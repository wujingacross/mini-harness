import type { ContentBlock } from './blocks.js'
import type { StreamChunk, TokenUsage } from './stream.js'

/** 对话轮次（Turn）的触发来源 */
export type TurnTrigger =
  | { kind: 'message'; source: string }   // 用户输入新消息
  | { kind: 'continuation' }              // 未完成任务自动续接
  | { kind: 'injection'; source: string } // 外部环境/系统事件主动注入

/** 对话轮次（Turn）的结束原因 */
export type TurnEndReason =
  | { kind: 'completed' }                         // 正常完成（无需继续调用工具）
  | { kind: 'aborted'; reason?: string }          // 被外部打断/取消
  | { kind: 'error'; step: number; message: string } // 异常报错终止
  | { kind: 'max-tokens' }                        // Token 达到上限

/** 核心事件溯源契约：定义系统运行时发生的全部不可变事件类型与 Payload */
export interface SessionEventMap {
  // 生命周期元事件
  'turn/start': { turn: number; trigger: TurnTrigger }
  'turn/end': { turn: number; reason: TurnEndReason }
  'step/start': { turn: number; step: number }
  'step/end': { turn: number; step: number }

  // 消息与内容事件
  'user/message': { content: ContentBlock[]; source?: string }
  'context/message': { content: ContentBlock[]; source?: string }
  'assistant/chunk': { turn: number; step: number; chunk: StreamChunk }
  'assistant/message': { turn: number; step: number; content: ContentBlock[]; usage?: TokenUsage }

  // 工具交互闭环事件
  'tool/call': { turn: number; step: number; callId: string; name: string; arguments: Record<string, unknown> }
  'tool/result': { turn: number; step: number; callId: string; content: string; isError?: boolean }

  // 高级干预：用户中途插话纠偏
  'steering/message': { turn: number; content: ContentBlock[]; source?: string }
}

export type SessionEventType = keyof SessionEventMap

/** 具备单调自增序号 (seq) 和时间戳的强类型不可变日志条目 */
export type SessionEvent<K extends SessionEventType = SessionEventType> = {
  [T in SessionEventType]: {
    type: T
    seq: number   // 单调自增序号 0, 1, 2...
    time: number  // 时间戳 (ms)
    data: SessionEventMap[T]
  }
}[K]
