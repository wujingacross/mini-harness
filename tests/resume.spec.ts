import { describe, it, expect, beforeEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { Context } from 'cordis'
import SessionStore from '../src/session/index.js'
import SystemPrompt from '../src/system-prompt/index.js'
import ToolRegistry from '../src/tools/index.js'
import LlmService from '../src/llm/index.js'
import { MockLlmAdapter } from '../src/llm/mock.js'
import AgentRegistry from '../src/agent/index.js'
import AgentLoop from '../src/agent-loop/index.js'
import { JsonlSessionPersistence } from '../src/session-persistence/jsonl.js'

const testStorageDir = join(process.cwd(), '.tmp-test-resume')

describe('Milestone 3: Agent Persistence & Seamless Resume', () => {
  beforeEach(async () => {
    await fs.rm(testStorageDir, { recursive: true, force: true })
    await fs.mkdir(testStorageDir, { recursive: true })
  })

  it('preserves history across restarts and resumes seamlessly', async () => {
    const sessionId = 'session-to-resume-1'

    // ==========================================
    // 阶段 1：进程 1 启动，运行第一轮对话并持久化
    // ==========================================
    {
      const ctx1 = new Context()
      await ctx1.plugin(SessionStore)
      await ctx1.plugin(SystemPrompt)
      await ctx1.plugin(ToolRegistry)
      await ctx1.plugin(LlmService)
      await ctx1.plugin(JsonlSessionPersistence, { storageDir: testStorageDir })
      await ctx1.plugin(AgentRegistry)
      await ctx1.plugin(AgentLoop)

      ctx1.llm.registerAdapter(['mock', 'default'], new MockLlmAdapter())

      // 注册工具
      ctx1.tools.register({
        name: 'echo',
        description: 'echo',
        parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
        execute(args: { message: string }) {
          return `ECHO: ${args.message}`
        },
      })

      const agent1 = ctx1.agentLoop.createAgent(sessionId, { model: 'mock' })
      agent1.send('echo secret-code-42')
      await agent1.whenIdle()

      // 确认 Turn 1 执行完毕
      expect(agent1.session.events.length).toBeGreaterThan(0)
    } // ctx1 销毁，模拟进程退出

    // ==========================================
    // 阶段 2：进程 2 重启，从持久化日志中恢复 Agent
    // ==========================================
    {
      const ctx2 = new Context()
      await ctx2.plugin(SessionStore)
      await ctx2.plugin(SystemPrompt)
      await ctx2.plugin(ToolRegistry)
      await ctx2.plugin(LlmService)
      await ctx2.plugin(JsonlSessionPersistence, { storageDir: testStorageDir })
      await ctx2.plugin(AgentRegistry)
      await ctx2.plugin(AgentLoop)

      ctx2.llm.registerAdapter(['mock', 'default'], new MockLlmAdapter())

      // 恢复 Agent
      const resumedAgent = await ctx2.agentLoop.resumeAgent(sessionId, 'resumed-agent', { model: 'mock' })
      
      // 验证历史记录已完整还原
      expect(resumedAgent.id).toBe('resumed-agent')
      expect(resumedAgent.session.id).toBe(sessionId)
      expect(resumedAgent.session.events.length).toBeGreaterThan(0)

      const history = resumedAgent.session.deriveMessages()
      expect(history.length).toBeGreaterThanOrEqual(3)

      // 继续在恢复后的 Agent 上发起 Turn 2 对话
      resumedAgent.send('continue with new task')
      await resumedAgent.whenIdle()

      // 验证 Turn 2 顺利执行，turn 计数递增
      const turnStarts = resumedAgent.session.events.filter(e => e.type === 'turn/start')
      expect(turnStarts).toHaveLength(2)
      expect(turnStarts[1]?.data.turn).toBe(2)
    }
  })
})
