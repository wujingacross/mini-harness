import { LlmAdapter, type GenerateOptions } from './types.js'
import type { StreamChunk } from '../types/stream.js'

export class MockLlmAdapter extends LlmAdapter {
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const lastMsg = options.messages[options.messages.length - 1]
    
    // Check if the last message is a tool result
    const toolResult = lastMsg?.content.find(b => b.type === 'tool-result')
    if (toolResult && toolResult.type === 'tool-result') {
      // Step 2: Model receives tool result and produces final answer
      yield { type: 'block-start', index: 0, blockType: 'text' }
      const reply = `[Mock Model] Received tool execution result: "${toolResult.content}". I have finished processing.`
      for (const char of reply) {
        yield { type: 'text-delta', index: 0, text: char }
        await new Promise(r => setTimeout(r, 10))
      }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
      yield { type: 'usage', usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }

    // Step 1: Check user input
    const userText = lastMsg?.content.find(b => b.type === 'text')
    const text = userText && userText.type === 'text' ? userText.text.trim() : ''

    if (text.startsWith('echo ') || text === 'echo') {
      const echoArg = text.replace(/^echo\s*/, '') || 'Hello World!'
      
      // 1. Thinking / Reasoning
      yield { type: 'block-start', index: 0, blockType: 'reasoning' }
      const thought = `User wants to echo "${echoArg}". I will call the 'echo' tool.`
      for (const char of thought) {
        yield { type: 'reasoning-delta', index: 0, text: char }
        await new Promise(r => setTimeout(r, 10))
      }
      yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: thought } }

      // 2. Tool Call
      const callId = `call_${Date.now()}`
      const argsObj = { message: echoArg }
      const argsStr = JSON.stringify(argsObj)

      yield { type: 'block-start', index: 1, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 1, id: callId, name: 'echo', argumentsDelta: argsStr }
      yield {
        type: 'block-end',
        index: 1,
        block: { type: 'tool-call', id: callId, name: 'echo', arguments: argsObj },
      }

      yield { type: 'usage', usage: { promptTokens: 20, completionTokens: 40, totalTokens: 60 } }
      yield { type: 'finish', reason: { kind: 'tool-use' } }
      return
    }

    // General prompt: produce direct text
    yield { type: 'block-start', index: 0, blockType: 'text' }
    const response = `[Mock Model] Hello! You said: "${text}". Try typing "echo something" to test tool invocation!`
    for (const char of response) {
      yield { type: 'text-delta', index: 0, text: char }
      await new Promise(r => setTimeout(r, 10))
    }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: response } }
    yield { type: 'usage', usage: { promptTokens: 10, completionTokens: 25, totalTokens: 35 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
