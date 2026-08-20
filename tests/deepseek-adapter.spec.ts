import { describe, it, expect } from 'vitest'
import { DeepSeekAdapter } from '../src/llm/deepseek.js'
import type { GenerateOptions } from '../src/llm/types.js'

describe('Milestone 2: DeepSeek LLM Adapter', () => {
  it('instantiates adapter with options', () => {
    const adapter = new DeepSeekAdapter({
      apiKey: 'test-key',
      baseURL: 'https://api.deepseek.com/v1',
    })
    expect(adapter).toBeInstanceOf(DeepSeekAdapter)
  })

  it('correctly serializes messages with tool-result and tool-calls', () => {
    const adapter = new DeepSeekAdapter({ apiKey: 'test-key' })
    const serializer = (adapter as any).serializeMessages.bind(adapter)

    const wire = serializer('You are a coding assistant', [
      { role: 'user', content: [{ type: 'text', text: 'run bash' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Executing...' },
          {
            type: 'tool-call',
            id: 'call_123',
            name: 'bash',
            arguments: { command: 'ls' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_123',
            content: 'file1.txt\nfile2.txt',
          },
        ],
      },
    ])

    expect(wire).toHaveLength(4)
    expect(wire[0]).toEqual({ role: 'system', content: 'You are a coding assistant' })
    expect(wire[1]).toEqual({ role: 'user', content: 'run bash' })
    expect(wire[2].role).toBe('assistant')
    expect(wire[2].tool_calls).toHaveLength(1)
    expect(wire[2].tool_calls[0].id).toBe('call_123')
    expect(wire[3]).toEqual({
      role: 'tool',
      tool_call_id: 'call_123',
      content: 'file1.txt\nfile2.txt',
    })
  })
})
