import type { Readable, Writable } from 'node:stream'
import { Context, Service } from 'cordis'
import type { Agent } from '../agent/index.js'
import { JsonRpcConnection } from './connection.js'
import type { SessionPersistence } from '../session-persistence/index.js'
import {
  type AcpInitializeParams,
  type AcpInitializeResult,
  type AcpSessionNewParams,
  type AcpSessionNewResult,
  type AcpSessionLoadParams,
  type AcpSessionLoadResult,
  type AcpSessionPromptParams,
  type AcpSessionPromptResult,
  type AcpSessionCancelParams,
  type AcpSessionUpdateParams,
  acpPromptToText,
  turnEndToStopReason,
} from './types.js'

export interface AcpBridgeConfig {
  input?: Readable
  output?: Writable
  model?: string
  systemPrompt?: string
  serverName?: string
  serverVersion?: string
}

interface SessionEntry {
  sessionId: string
  agent: Agent
  cwd: string
}

declare module 'cordis' {
  interface Context {
    acpBridge: AcpBridge
  }
}

/**
 * Agent Client Protocol (ACP) 桥接网关服务：
 * 1. 标准 JSON-RPC 2.0 stdio 协议桥接（支持 Zed / VSCode 等任意 ACP 客户端）；
 * 2. 多会话多任务并发多路复用（Multi-Session Multiplexing）；
 * 3. 实时打字机思考流与工具卡片双向推送（session/update 通知）；
 * 4. 完整的会话重载与历史记录回放（session/load 回放）；
 * 5. 精准的单次 Prompt 结算与优雅取消控制（session/prompt & session/cancel）。
 */
export class AcpBridge extends Service {
  static inject = ['agents', 'sessions', 'agentLoop', 'tools']
  private conn: JsonRpcConnection
  private sessions = new Map<string, SessionEntry>()
  private agentToSessionId = new WeakMap<Agent, string>()
  private defaultModel?: string
  private defaultSystemPrompt?: string
  private serverName: string
  private serverVersion: string

  constructor(ctx: Context, config: AcpBridgeConfig = {}) {
    super(ctx, 'acpBridge')
    this.defaultModel = config.model
    this.defaultSystemPrompt = config.systemPrompt
    this.serverName = config.serverName || 'mini-harness-acp'
    this.serverVersion = config.serverVersion || '0.4.0'

    const input = config.input || process.stdin
    const output = config.output || process.stdout
    this.conn = new JsonRpcConnection(input, output)

    this.setupRpcHandlers()
    this.setupAgentEventForwarding()
  }

  getConnection(): JsonRpcConnection {
    return this.conn
  }

  private setupRpcHandlers(): void {
    // 1. initialize: 握手并协商协议版本与能力
    this.conn.onRequest('initialize', async (_params: AcpInitializeParams): Promise<AcpInitializeResult> => {
      return {
        protocolVersion: 1,
        agentInfo: {
          name: this.serverName,
          version: this.serverVersion,
        },
        agentCapabilities: {
          loadSession: true,
        },
      }
    })

    // 2. session/new: 创建全新会话
    this.conn.onRequest('session/new', async (params: AcpSessionNewParams): Promise<AcpSessionNewResult> => {
      const sessionId = params.sessionId || `acp-ses-${Date.now()}`
      const agent = this.ctx.agentLoop.createAgent(sessionId, {
        model: this.defaultModel,
        systemPrompt: this.defaultSystemPrompt,
      })

      const entry: SessionEntry = {
        sessionId,
        agent,
        cwd: params.cwd || process.cwd(),
      }

      this.sessions.set(sessionId, entry)
      this.agentToSessionId.set(agent, sessionId)

      return { sessionId }
    })

    // 3. session/load: 跨进程加载历史会话并向编辑器回放卡片
    this.conn.onRequest('session/load', async (params: AcpSessionLoadParams): Promise<AcpSessionLoadResult> => {
      const { sessionId, cwd } = params
      const persistence = this.ctx.get('sessionPersistence') as SessionPersistence | undefined
      if (!persistence) {
        throw new Error('SessionPersistence service is not enabled')
      }

      const agent = await this.ctx.agentLoop.resumeAgent(sessionId, sessionId, {
        model: this.defaultModel,
        systemPrompt: this.defaultSystemPrompt,
      })

      const entry: SessionEntry = {
        sessionId,
        agent,
        cwd: cwd || process.cwd(),
      }

      this.sessions.set(sessionId, entry)
      this.agentToSessionId.set(agent, sessionId)

      // 回放历史事件，让 IDE 重建聊天历史卡片
      this.replayHistoryToClient(sessionId, agent.session.events)

      return { sessionId }
    })

    // 4. session/prompt: 核心对话交互与一次性结算
    this.conn.onRequest('session/prompt', async (params: AcpSessionPromptParams): Promise<AcpSessionPromptResult> => {
      const { sessionId, prompt } = params
      const entry = this.sessions.get(sessionId)
      if (!entry) {
        throw new Error(`Session "${sessionId}" not found`)
      }

      const text = acpPromptToText(prompt)
      if (!text.trim()) {
        throw new Error('Prompt cannot be empty')
      }

      return new Promise<AcpSessionPromptResult>((resolve, reject) => {
        let settled = false

        const turnEndDisposer = this.ctx.on('agent/turn-end', (agent, _turn, reason) => {
          if (agent.id !== entry.agent.id) return
          if (settled) return
          settled = true
          turnEndDisposer()

          if (reason.kind === 'error') {
            reject(new Error(reason.message))
          } else {
            resolve({ stopReason: turnEndToStopReason(reason) })
          }
        })

        entry.agent.send(text)
      })
    })

    // 5. session/cancel: 取消当前会话正在执行的任务
    this.conn.onRequest('session/cancel', async (params: AcpSessionCancelParams) => {
      const entry = this.sessions.get(params.sessionId)
      if (entry) {
        entry.agent.cancel('cancelled by ACP client')
      }
      return {}
    })
  }

  private setupAgentEventForwarding(): void {
    // 实时推送思考流与回复流
    this.ctx.on('agent/chunk', (agent, chunk) => {
      const sessionId = this.agentToSessionId.get(agent)
      if (!sessionId) return

      if (chunk.type === 'reasoning-delta') {
        this.notifyUpdate(sessionId, {
          sessionUpdate: 'agent_thought_chunk',
          type: 'agent_thought_chunk',
          content: { type: 'text', text: chunk.text },
        })
      } else if (chunk.type === 'text-delta') {
        this.notifyUpdate(sessionId, {
          sessionUpdate: 'agent_message_chunk',
          type: 'agent_message_chunk',
          content: { type: 'text', text: chunk.text },
        })
      }
    })

    // 实时推送工具调用卡片
    this.ctx.on('agent/tool-call', (agent, call) => {
      const sessionId = this.agentToSessionId.get(agent)
      if (!sessionId) return

      this.notifyUpdate(sessionId, {
        sessionUpdate: 'tool_call',
        type: 'tool_call',
        toolCallId: call.id,
        callId: call.id,
        name: call.name,
        title: `${call.name} (${JSON.stringify(call.arguments)})`,
        kind: 'execute',
        status: 'in_progress',
        rawInput: call.arguments,
      })
    })

    // 实时推送工具执行结果
    this.ctx.on('agent/tool-result', (agent, res) => {
      const sessionId = this.agentToSessionId.get(agent)
      if (!sessionId) return

      this.notifyUpdate(sessionId, {
        sessionUpdate: 'tool_call_update',
        type: 'tool_call_update',
        toolCallId: res.callId,
        callId: res.callId,
        status: res.isError ? 'failed' : 'completed',
        content: typeof res.content === 'string'
          ? [{ type: 'content', content: { type: 'text', text: res.content } }]
          : res.content,
        isError: res.isError,
      })
    })
  }

  private notifyUpdate(sessionId: string, update: any): void {
    this.conn.notify<AcpSessionUpdateParams>('session/update', {
      sessionId,
      update,
      sessionUpdate: update,
    })
  }

  private replayHistoryToClient(sessionId: string, events: readonly any[]): void {
    for (const e of events) {
      if (e.type === 'user/message') {
        const text = e.data.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('\n')
        this.notifyUpdate(sessionId, {
          sessionUpdate: 'user_message_chunk',
          type: 'user_message_chunk',
          content: { type: 'text', text },
        })
      } else if (e.type === 'assistant/message') {
        for (const block of e.data.content) {
          if (block.type === 'text') {
            this.notifyUpdate(sessionId, {
              sessionUpdate: 'agent_message_chunk',
              type: 'agent_message_chunk',
              content: { type: 'text', text: block.text },
            })
          } else if (block.type === 'reasoning') {
            this.notifyUpdate(sessionId, {
              sessionUpdate: 'agent_thought_chunk',
              type: 'agent_thought_chunk',
              content: { type: 'text', text: block.text },
            })
          } else if (block.type === 'tool-call') {
            this.notifyUpdate(sessionId, {
              sessionUpdate: 'tool_call',
              type: 'tool_call',
              toolCallId: block.id,
              callId: block.id,
              name: block.name,
              title: `${block.name} (${JSON.stringify(block.arguments)})`,
              kind: 'execute',
              status: 'completed',
              rawInput: block.arguments,
            })
          }
        }
      } else if (e.type === 'tool/result') {
        this.notifyUpdate(sessionId, {
          sessionUpdate: 'tool_call_update',
          type: 'tool_call_update',
          toolCallId: e.data.callId,
          callId: e.data.callId,
          status: e.data.isError ? 'failed' : 'completed',
          content: typeof e.data.content === 'string'
            ? [{ type: 'content', content: { type: 'text', text: e.data.content } }]
            : e.data.content,
          isError: e.data.isError,
        })
      }
    }
  }
}

export default AcpBridge
