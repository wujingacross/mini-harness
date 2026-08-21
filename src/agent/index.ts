import { Context, Service } from 'cordis'
import type { ContentBlock } from '../types/blocks.js'
import type { StreamChunk } from '../types/stream.js'
import type { Session, TurnEndReason } from '../session/index.js'

export type AgentStatus = 'idle' | 'running' | 'disposed'

export interface AgentOptions {
  model?: string
  systemPrompt?: string
}

export interface Agent {
  readonly id: string
  readonly options: AgentOptions
  readonly session: Session
  readonly status: AgentStatus

  send(content: ContentBlock[] | string): void
  cancel(reason?: string): void
  whenIdle(): Promise<void>
}

declare module 'cordis' {
  interface Context {
    agents: AgentRegistry
  }

  interface Events {
    'agent/created'(agent: Agent): void
    'agent/status'(agent: Agent, status: AgentStatus): void
    'agent/turn-start'(agent: Agent, turn: number): void
    'agent/turn-end'(agent: Agent, turn: number, reason: TurnEndReason): void
    'agent/step-start'(agent: Agent, turn: number, step: number): void
    'agent/step-end'(agent: Agent, turn: number, step: number): void
    'agent/chunk'(agent: Agent, chunk: StreamChunk): void
    'agent/tool-call'(agent: Agent, call: { id: string; name: string; arguments: Record<string, unknown> }): void
    'agent/tool-result'(agent: Agent, result: { callId: string; content: string; isError?: boolean }): void
  }
}

export class AgentRegistry extends Service {
  private agents = new Map<string, Agent>()

  constructor(ctx: Context) {
    super(ctx, 'agents')
  }

  register(agent: Agent): () => void {
    this.agents.set(agent.id, agent)
    this.ctx.emit('agent/created', agent)
    return () => {
      this.agents.delete(agent.id)
    }
  }

  get(id: string): Agent | undefined {
    return this.agents.get(id)
  }

  list(): Agent[] {
    return Array.from(this.agents.values())
  }
}

export default AgentRegistry
