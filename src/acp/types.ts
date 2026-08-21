import type { TurnEndReason } from '../types/session.js'

// ==========================================
// JSON-RPC 2.0 基础协议定义
// ==========================================

export interface JsonRpcRequest<T = any> {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: T
}

export interface JsonRpcResponse<T = any> {
  jsonrpc: '2.0'
  id: string | number
  result?: T
  error?: {
    code: number
    message: string
    data?: any
  }
}

export interface JsonRpcNotification<T = any> {
  jsonrpc: '2.0'
  method: string
  params: T
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification

// ==========================================
// Agent Client Protocol (ACP) 协议类型定义
// ==========================================

export type AcpStopReason = 'end_turn' | 'max_tokens' | 'cancelled'

export type AcpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'resource_link'; name: string; uri: string }

export type AcpSessionUpdate =
  | { type: 'agent_thought_chunk'; content: string }
  | { type: 'agent_message_chunk'; content: string }
  | { type: 'user_message_chunk'; content: string }
  | { type: 'tool_call'; callId: string; name: string; title?: string; kind?: string; rawInput?: any }
  | { type: 'tool_call_update'; callId: string; content?: string; isError?: boolean }

export interface AcpInitializeParams {
  protocolVersion: number
  clientInfo?: {
    name: string
    version?: string
  }
  clientCapabilities?: Record<string, any>
}

export interface AcpInitializeResult {
  protocolVersion: number
  serverInfo: {
    name: string
    version: string
  }
  serverCapabilities: {
    loadSession: boolean
  }
}

export interface AcpSessionNewParams {
  sessionId?: string
  cwd: string
}

export interface AcpSessionNewResult {
  sessionId: string
}

export interface AcpSessionLoadParams {
  sessionId: string
  cwd: string
}

export interface AcpSessionLoadResult {
  sessionId: string
}

export interface AcpSessionPromptParams {
  sessionId: string
  prompt: string | AcpContentBlock[]
}

export interface AcpSessionPromptResult {
  stopReason: AcpStopReason
}

export interface AcpSessionCancelParams {
  sessionId: string
}

export interface AcpSessionUpdateParams {
  sessionId: string
  update: AcpSessionUpdate
}

// ==========================================
// 纯编解码转换辅助函数 (Codec)
// ==========================================

/**
 * 将内部 TurnEndReason 映射为 ACP 协议标准的 stopReason
 */
export function turnEndToStopReason(reason: TurnEndReason): AcpStopReason {
  switch (reason.kind) {
    case 'completed':
      return 'end_turn'
    case 'max-tokens':
      return 'max_tokens'
    case 'aborted':
      return 'cancelled'
    case 'error':
      return 'end_turn'
    default:
      return 'end_turn'
  }
}

/**
 * 从 ACP 的 prompt 载荷中提取统一的纯文本内容
 */
export function acpPromptToText(prompt: string | AcpContentBlock[]): string {
  if (typeof prompt === 'string') return prompt
  return prompt
    .map((block) => {
      if (block.type === 'text') return block.text
      if (block.type === 'resource_link') {
        return `\n[resource_link name=${JSON.stringify(block.name)} uri=${JSON.stringify(block.uri)}]\n`
      }
      return ''
    })
    .join('')
}
