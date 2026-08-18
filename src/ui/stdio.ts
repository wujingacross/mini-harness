import readline from 'node:readline'
import type { Context } from 'cordis'
import type { Agent } from '../agent/index.js'

/** 绑定控制台 Stdio 终端交互界面：监听 Agent 广播事件实现流式打字与彩色工具卡片 */
export function attachStdioUI(ctx: Context, agent: Agent): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  // Format colors using ANSI codes
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
  const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`
  const green = (s: string) => `\x1b[32m${s}\x1b[0m`
  const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
  const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`

  ctx.on('agent/turn-start', (a, turn) => {
    if (a.id !== agent.id) return
    console.log(dim(`\n--- Turn ${turn} Start ---`))
  })

  ctx.on('agent/step-start', (a, turn, step) => {
    if (a.id !== agent.id) return
    console.log(dim(`[Step ${step}] Thinking & Planning...`))
  })

  let currentBlockType: string | null = null

  // 监听流式分片：打字机式实时渲染思考过程与助手文本
  ctx.on('agent/chunk', (a, chunk) => {
    if (a.id !== agent.id) return

    if (chunk.type === 'reasoning-delta') {
      if (currentBlockType !== 'reasoning') {
        process.stdout.write(dim('\n[Reasoning] '))
        currentBlockType = 'reasoning'
      }
      process.stdout.write(dim(chunk.text))
    } else if (chunk.type === 'text-delta') {
      if (currentBlockType !== 'text') {
        process.stdout.write(cyan('\n[Assistant] '))
        currentBlockType = 'text'
      }
      process.stdout.write(chunk.text)
    }
  })

  // 监听工具调用广播：渲染黄色工具卡片
  ctx.on('agent/tool-call', (a, call) => {
    if (a.id !== agent.id) return
    currentBlockType = null
    console.log(yellow(`\n[Tool Call] 🔧 ${call.name}(${JSON.stringify(call.arguments)})`))
  })

  // 监听工具结果广播：渲染执行结果或错误
  ctx.on('agent/tool-result', (a, res) => {
    if (a.id !== agent.id) return
    currentBlockType = null
    const tag = res.isError ? '\x1b[31m[Tool Error]\x1b[0m' : green('[Tool Result]')
    console.log(`${tag} ➔ ${res.content}`)
  })

  ctx.on('agent/turn-end', (a, turn, reason) => {
    if (a.id !== agent.id) return
    currentBlockType = null
    console.log(dim(`\n--- Turn ${turn} Finished (${reason.kind}) ---\n`))
  })

  /** 控制台 REPL 交互递归循环 */
  function promptUser() {
    rl.question(magenta('user > '), async (line) => {
      const trimmed = line.trim()
      if (trimmed === 'exit' || trimmed === 'quit') {
        console.log('Bye!')
        rl.close()
        process.exit(0)
      }

      if (trimmed) {
        agent.send(trimmed)
        // 阻塞等待本轮任务完全结束，保持有序的一问一答交互节奏
        await agent.whenIdle()
      }

      // 递归开启下一轮提示
      promptUser()
    })
  }

  console.log(cyan('=== Mini Harness: Echo Agent Demo ==='))
  console.log(dim('Type "echo <message>" to test tool invocation, or anything else to chat. Type "exit" to quit.\n'))
  promptUser()
}
