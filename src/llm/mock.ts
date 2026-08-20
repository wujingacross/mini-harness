import { LlmAdapter, type GenerateOptions } from './types.js'
import type { StreamChunk } from '../types/stream.js'

/** 大模型高仿真模拟器：模拟真实大模型在两阶段 ReAct 循环中的流式思考、工具调用与最终回答 */
export class MockLlmAdapter extends LlmAdapter {
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const lastMsg = options.messages[options.messages.length - 1]
    
    // 【分支 1：Step 2 场景】检测到消息末尾为工具执行结果，输出最终回复（finish: stop）
    const toolResult = lastMsg?.content.find(b => b.type === 'tool-result')
    if (toolResult && toolResult.type === 'tool-result') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      const reply = `[Mock Model] Received tool execution result: "${toolResult.content}". I have finished processing.`
      for (const char of reply) {
        yield { type: 'text-delta', index: 0, text: char }
        await new Promise(r => setTimeout(r, 10))
      }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
      yield { type: 'usage', usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 } }
      yield { type: 'finish', reason: { kind: 'stop' } } // 任务完成，无后续工具调用
      return
    }

    // 【分支 2：Step 1 场景】识别到 echo 指令，模拟输出思考流 + 发起工具调用请求（finish: tool-use）
    const userText = lastMsg?.content.find(b => b.type === 'text')
    const text = userText && userText.type === 'text' ? userText.text.trim() : ''

    if (text.startsWith('echo ') || text === 'echo') {
      const echoArg = text.replace(/^echo\s*/, '') || 'Hello World!'
      
      // 1. 模拟 DeepSeek-R1 思考流 (<think> 推理过程)
      yield { type: 'block-start', index: 0, blockType: 'reasoning' }
      const thought = `User wants to echo "${echoArg}". I will call the 'echo' tool.`
      for (const char of thought) {
        yield { type: 'reasoning-delta', index: 0, text: char }
        await new Promise(r => setTimeout(r, 10))
      }
      yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: thought } }

      // 2. 模拟工具调用请求 (符合 JSON Schema 的结构化参数)
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
      yield { type: 'finish', reason: { kind: 'tool-use' } } // 告知 Agent 本地执行工具
      return
    }

    // 【分支 3：普通闲聊场景】直接输出文本回复（finish: stop）
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
