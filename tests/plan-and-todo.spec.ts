import { describe, it, expect, beforeEach } from 'vitest'
import { Context } from 'cordis'
import SessionStore from '../src/session/index.js'
import SystemPrompt, { renderPrompt } from '../src/system-prompt/index.js'
import ToolRegistry from '../src/tools/index.js'
import LlmService from '../src/llm/index.js'
import { MockLlmAdapter } from '../src/llm/mock.js'
import AgentRegistry from '../src/agent/index.js'
import AgentLoop from '../src/agent-loop/index.js'
import PlanMode, { PlanModeController, EXIT_PLAN_MODE } from '../src/plan/index.js'
import ToolTodo, { createTodoWriteTool, deriveTodos } from '../src/todo/index.js'

describe('Milestone 9: Plan Mode & Structured Todo Tracking', () => {
  let ctx: Context
  let mockLlm: MockLlmAdapter

  beforeEach(async () => {
    ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(LlmService)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop)

    mockLlm = new MockLlmAdapter()
    ctx.llm.registerAdapter(['mock-llm'], mockLlm)
    ctx.llm.setDefaultAdapter(mockLlm)

    await ctx.plugin(PlanMode, { autoApprove: true })
    await ctx.plugin(ToolTodo, { allowParallelInProgress: false })
  })

  describe('Todo Tracking (todo_write & deriveTodos)', () => {
    it('rejects invalid inputs: non-array, empty content, duplicate content, unknown status', async () => {
      const session = ctx.sessions.create('ses_todo_val')
      const tool = createTodoWriteTool({ allowParallelInProgress: false })
      const exec = { callId: 'call_1', name: 'todo_write', arguments: {}, session }

      // 1. Non-array
      await expect(tool.execute({ todos: 'not-an-array' as any }, exec)).rejects.toThrow('must be an array')

      // 2. Empty content
      await expect(
        tool.execute(
          {
            todos: [{ content: '   ', status: 'pending' }],
          },
          exec,
        ),
      ).rejects.toThrow('must be a non-empty string')

      // 3. Duplicate content
      await expect(
        tool.execute(
          {
            todos: [
              { content: 'Write unit tests', status: 'pending' },
              { content: 'Write unit tests', status: 'in_progress' },
            ],
          },
          exec,
        ),
      ).rejects.toThrow('duplicate content')

      // 4. Unknown status
      await expect(
        tool.execute(
          {
            todos: [{ content: 'Deploy to prod', status: 'blocked' as any }],
          },
          exec,
        ),
      ).rejects.toThrow('unknown status "blocked"')
    })

    it('enforces single in_progress task by default (allowParallelInProgress = false)', async () => {
      const session = ctx.sessions.create('ses_todo_parallel')
      const tool = createTodoWriteTool({ allowParallelInProgress: false })
      const exec = { callId: 'call_2', name: 'todo_write', arguments: {}, session }

      await expect(
        tool.execute(
          {
            todos: [
              { content: 'Task 1', status: 'in_progress' },
              { content: 'Task 2', status: 'in_progress' },
            ],
          },
          exec,
        ),
      ).rejects.toThrow('at most one task may be in_progress')
    })

    it('permits multiple in_progress tasks when allowParallelInProgress = true', async () => {
      const session = ctx.sessions.create('ses_todo_parallel_allowed')
      const tool = createTodoWriteTool({ allowParallelInProgress: true })
      const exec = { callId: 'call_3', name: 'todo_write', arguments: {}, session }

      const res = await tool.execute(
        {
          todos: [
            { content: 'Task 1', status: 'in_progress' },
            { content: 'Task 2', status: 'in_progress' },
            { content: 'Task 3', status: 'completed' },
          ],
        },
        exec,
      )

      expect(res).toContain('Updated todo list: 0 pending, 2 in progress, 1 completed.')
      const latestTodos = deriveTodos(session)
      expect(latestTodos).toHaveLength(3)
      expect(latestTodos[0].content).toBe('Task 1')
      expect(latestTodos[0].status).toBe('in_progress')
      expect(latestTodos[2].status).toBe('completed')
    })

    it('supports whole-list replacement and deterministic derivation from session log', async () => {
      const session = ctx.sessions.create('ses_todo_replace')
      const tool = createTodoWriteTool()
      const exec = { callId: 'call_4', name: 'todo_write', arguments: {}, session }

      // Initial write: 2 tasks
      await tool.execute(
        {
          todos: [
            { content: 'Explore repo', status: 'completed' },
            { content: 'Write code', status: 'in_progress' },
          ],
        },
        exec,
      )

      let current = deriveTodos(session)
      expect(current).toHaveLength(2)
      expect(current[0].status).toBe('completed')
      expect(current[1].status).toBe('in_progress')

      // Whole replacement: 3 tasks, previous 'Write code' is completed, new task added
      await tool.execute(
        {
          todos: [
            { content: 'Explore repo', status: 'completed' },
            { content: 'Write code', status: 'completed' },
            { content: 'Run test suite', status: 'in_progress' },
          ],
        },
        exec,
      )

      current = deriveTodos(session)
      expect(current).toHaveLength(3)
      expect(current[1].status).toBe('completed')
      expect(current[2].content).toBe('Run test suite')
      expect(current[2].status).toBe('in_progress')
    })
  })

  describe('Plan Mode (PlanModeController & exit_plan_mode)', () => {
    it('sets plan mode directly outside turn and dynamically injects plan:policy prompt section', async () => {
      const session = ctx.sessions.create('ses_plan_mode_basic')
      const planController = ctx.planMode

      expect(planController.isActive(session)).toBe(false)

      // Before activation: plan:policy section is empty
      let assembly = await ctx.systemPrompt.assemble(session)
      let rendered = renderPrompt(assembly, session)
      expect(rendered).not.toContain('[PLAN MODE ACTIVE]')

      // Activate plan mode
      const res = planController.set(session, true, 'user_command')
      expect(res).toBe('committed')
      expect(planController.isActive(session)).toBe(true)

      // After activation: plan:policy is injected with guidance
      assembly = await ctx.systemPrompt.assemble(session)
      rendered = renderPrompt(assembly, session)
      expect(rendered).toContain('[PLAN MODE ACTIVE]')
      expect(rendered).toContain('todo_write')
      expect(rendered).toContain('exit_plan_mode')

      // Deactivate plan mode
      planController.set(session, false, 'plan_off')
      expect(planController.isActive(session)).toBe(false)
      assembly = await ctx.systemPrompt.assemble(session)
      rendered = renderPrompt(assembly, session)
      expect(rendered).not.toContain('[PLAN MODE ACTIVE]')
    })

    it('exit_plan_mode validates active mode and # heading constraint', async () => {
      const session = ctx.sessions.create('ses_exit_plan_val')
      const planController = ctx.planMode
      const exitTool = ctx.tools.get(EXIT_PLAN_MODE)!
      expect(exitTool).toBeDefined()

      const exec = { callId: 'call_exit_1', name: EXIT_PLAN_MODE, arguments: {}, session }

      // 1. Calling when plan mode is not active -> throws
      await expect(exitTool.execute({ plan: '# Implementation Plan\n\n1. Do this' }, exec)).rejects.toThrow(
        'only available in plan mode',
      )

      // Turn on plan mode
      planController.set(session, true)

      // 2. Calling without # Heading -> throws
      await expect(exitTool.execute({ plan: 'No heading plan' }, exec)).rejects.toThrow(
        'starting with a # heading',
      )

      // 3. Valid markdown plan starting with # Heading -> auto approved
      const approvedMsg = await exitTool.execute(
        { plan: '# Feature Plan\n\n1. First step\n2. Second step' },
        exec,
      )
      expect(approvedMsg).toContain('Plan approved — plan mode exited')
      expect(planController.isActive(session)).toBe(false)
    })

    it('supports custom approvalHandler with feedback for revising the plan', async () => {
      const session = ctx.sessions.create('ses_exit_plan_feedback')
      const planController = ctx.planMode
      planController.set(session, true)

      // Custom handler rejecting the first plan with feedback
      let attempt = 0
      planController.setApprovalHandler(async (plan) => {
        attempt++
        if (attempt === 1) {
          return { approved: false, feedback: 'Please add rollback steps' }
        }
        return { approved: true }
      })

      const exitTool = ctx.tools.get(EXIT_PLAN_MODE)!
      const exec = { callId: 'call_exit_2', name: EXIT_PLAN_MODE, arguments: {}, session }

      // First attempt: rejected with feedback
      await expect(
        exitTool.execute({ plan: '# Plan Draft 1\n\nInitial steps' }, exec),
      ).rejects.toThrow('The user chose to keep planning; their feedback: Please add rollback steps')
      expect(planController.isActive(session)).toBe(true)

      // Second attempt: approved
      const res = await exitTool.execute(
        { plan: '# Plan Draft 2\n\nInitial steps with rollback' },
        exec,
      )
      expect(res).toContain('Plan approved')
      expect(planController.isActive(session)).toBe(false)
    })
  })

  describe('Agent Loop Integration with Commands (/plan, /plan off, /plan <msg>)', () => {
    it('processes /plan and /plan off commands via agent.send', async () => {
      const session = ctx.sessions.create('ses_loop_plan_cmd')
      const agent = ctx.agentLoop.createAgent(session.id, { model: 'mock-llm' })

      expect(ctx.planMode.isActive(session)).toBe(false)

      // 1. Send /plan command
      agent.send('/plan')
      expect(ctx.planMode.isActive(session)).toBe(true)
      const lastEvent = session.events[session.events.length - 1]
      expect(lastEvent.type).toBe('context/message')
      expect((lastEvent.data as any).content[0].text).toContain('Plan mode on')

      // 2. Send /plan off command
      agent.send('/plan off')
      expect(ctx.planMode.isActive(session)).toBe(false)
      const offEvent = session.events[session.events.length - 1]
      expect((offEvent.data as any).content[0].text).toContain('Plan mode off')
    })

    it('activates plan mode and queues user instruction when given /plan <instruction>', async () => {
      const session = ctx.sessions.create('ses_loop_plan_instr')
      const agent = ctx.agentLoop.createAgent(session.id, { model: 'mock-llm' })

      agent.send('/plan Design a new caching subsystem')
      expect(ctx.planMode.isActive(session)).toBe(true)

      await agent.whenIdle()
      expect(session.events.some((e) => e.type === 'user/message' && (e.data as any).content[0].text === 'Design a new caching subsystem')).toBe(true)
    })
  })
})
