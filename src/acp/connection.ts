import type { Readable, Writable } from 'node:stream'
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  JsonRpcMessage,
} from './types.js'

export type RequestHandler<TParams = any, TResult = any> = (params: TParams) => Promise<TResult> | TResult
export type NotificationHandler<TParams = any> = (params: TParams) => void

/**
 * 健壮的 JSON-RPC 2.0 标准双工通信引擎：
 * 1. 严格支持 Newline-Delimited JSON (NDJSON) 行级协议分帧；
 * 2. 支持标准的 Request/Response 响应与单向 Notification 广播；
 * 3. 规范处理 JSON 解析异常与错误码封装。
 */
export class JsonRpcConnection {
  private requestHandlers = new Map<string, RequestHandler>()
  private notificationHandlers = new Map<string, NotificationHandler>()
  private isClosed = false

  constructor(
    private input: Readable,
    private output: Writable,
  ) {
    this.setupReader()
  }

  onRequest<TParams = any, TResult = any>(
    method: string,
    handler: RequestHandler<TParams, TResult>,
  ): void {
    this.requestHandlers.set(method, handler)
  }

  onNotification<TParams = any>(method: string, handler: NotificationHandler<TParams>): void {
    this.notificationHandlers.set(method, handler)
  }

  notify<TParams = any>(method: string, params: TParams): void {
    if (this.isClosed) return
    const msg: JsonRpcNotification<TParams> = {
      jsonrpc: '2.0',
      method,
      params,
    }
    this.writeMessage(msg)
  }

  sendResult(id: string | number, result: any): void {
    if (this.isClosed) return
    const msg: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      result: result ?? null,
    }
    this.writeMessage(msg)
  }

  sendError(id: string | number, code: number, message: string, data?: any): void {
    if (this.isClosed) return
    const msg: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      error: { code, message, ...(data !== undefined ? { data } : {}) },
    }
    this.writeMessage(msg)
  }

  private writeMessage(msg: JsonRpcMessage): void {
    try {
      const line = JSON.stringify(msg) + '\n'
      this.output.write(line)
    } catch (err) {
      console.error('[ACP JSON-RPC] Write Error:', err)
    }
  }

  private setupReader(): void {
    let buffer = ''

    this.input.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString('utf-8')
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        this.handleLine(trimmed)
      }
    })

    this.input.on('end', () => {
      if (buffer.trim()) {
        this.handleLine(buffer.trim())
      }
      this.isClosed = true
    })

    this.input.on('error', (err) => {
      console.error('[ACP JSON-RPC] Input stream error:', err)
      this.isClosed = true
    })
  }

  private async handleLine(line: string): Promise<void> {
    let msg: any
    try {
      msg = JSON.parse(line)
    } catch {
      // JSON 解析错误
      this.sendError(null as any, -32700, 'Parse error: invalid JSON')
      return
    }

    if (!msg || msg.jsonrpc !== '2.0') {
      this.sendError(msg?.id ?? null, -32600, 'Invalid Request: missing jsonrpc="2.0"')
      return
    }

    // 1. 处理 Request (带有 id)
    if (msg.id !== undefined && typeof msg.method === 'string') {
      const handler = this.requestHandlers.get(msg.method)
      if (!handler) {
        this.sendError(msg.id, -32601, `Method not found: ${msg.method}`)
        return
      }

      try {
        const result = await handler(msg.params)
        this.sendResult(msg.id, result)
      } catch (err: any) {
        this.sendError(msg.id, -32603, err?.message || 'Internal error', {
          stack: err?.stack,
        })
      }
      return
    }

    // 2. 处理 Notification (无 id)
    if (typeof msg.method === 'string') {
      const handler = this.notificationHandlers.get(msg.method)
      if (handler) {
        try {
          handler(msg.params)
        } catch (err) {
          console.error(`[ACP JSON-RPC] Error handling notification ${msg.method}:`, err)
        }
      }
    }
  }

  close(): void {
    this.isClosed = true
  }
}
