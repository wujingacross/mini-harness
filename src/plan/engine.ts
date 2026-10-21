import { Context, Service } from 'cordis'
import type { Session } from '../session/index.js'
import type { PlanModeConfig, PlanApprovalDecision, PlanApprovalHandler, PlanState } from './types.js'

export const DEFAULT_PLAN_SECTION = `[PLAN MODE ACTIVE]
You are currently in PLAN MODE. Follow these rules strictly:
1. FIRST ACTION: You MUST call \`todo_write\` in your VERY FIRST STEP to establish and project the plan-phase investigation tasks before doing deep exploration.
2. SCOPE OF TODOS: Scope this plan-phase todo list STRICTLY to 2-4 concrete investigation and research steps (e.g. "Review project architecture", "Analyze hardcoded strings", "Draft Markdown proposal"). Do NOT put future post-approval coding/implementation phases into this list.
3. CONCISE & FOCUSED EXPLORATION: Explore the codebase efficiently using dedicated tools (view_file, find_by_name, grep_search). Do not run excessive, repetitive shell greps. Inspect only necessary files.
4. ROADMAP IN PROPOSAL: In your Markdown proposal, clearly define the future implementation roadmap and concrete milestones in detail.
5. NO CODE MODIFICATIONS: Do NOT make file edits, modify code, or run destructive commands while in plan mode.
6. EXITING PLAN MODE: When your investigation and design are complete, mark all plan-phase research todos completed (100%), and present your complete proposal using the \`exit_plan_mode\` tool. Your plan must be in Markdown format and start with a top-level heading (# Heading).
7. POST-APPROVAL EXECUTION: Once the plan is approved, plan mode will automatically exit and you can proceed with execution by initializing a fresh implementation todo list via \`todo_write\`.`

declare module 'cordis' {
  interface Context {
    planMode: PlanModeController
  }
}

export class PlanModeController extends Service {
  static inject = ['systemPrompt', 'tools', 'sessions']

  private config: PlanModeConfig
  private pendingIntents = new WeakMap<Session, { active: boolean; reason?: 'user_command' | 'plan_approved' | 'plan_off' }>()
  private approvalHandler?: PlanApprovalHandler

  constructor(ctx: Context, config: PlanModeConfig = {}) {
    super(ctx, 'planMode')
    this.config = {
      section: config.section || DEFAULT_PLAN_SECTION,
      autoApprove: config.autoApprove ?? true,
    }

    // 动态向系统提示词注册 plan:policy 小节
    this.ctx.systemPrompt.section({
      name: 'plan:policy',
      order: 50,
      text: (session) => {
        if (!session || !this.isActive(session)) return ''
        return this.config.section || DEFAULT_PLAN_SECTION
      },
    })

    // 在每一个 Step 边界原子生效并持久化 pending 的状态变更
    this.ctx.on('agent/step-start', (agent) => {
      this.commitPending(agent.session)
    })

    this.ctx.on('agent/turn-end', (agent) => {
      this.commitPending(agent.session)
    })

    // 在 Plan 模式下物理拦截所有修改文件的工具调用（Hard Policy Guard）
    const writeTools = new Set(['write_to_file', 'replace_file_content', 'multi_replace_file_content'])
    this.ctx.on('tools/execute', async (exec, next) => {
      if (exec.session && this.isActive(exec.session)) {
        if (writeTools.has(exec.name)) {
          return {
            content: `Tool "${exec.name}" is forbidden in PLAN MODE. You are in read-only planning mode. Do NOT edit files or modify code until your plan is submitted and approved via exit_plan_mode.`,
            isError: true,
          }
        }
      }
      return await next()
    })
  }

  /**
   * 检查会话当前是否处于 Plan 模式（包含尚未落盘但在当前轮次排队的 pending 意图）
   */
  isActive(session: Session): boolean {
    const pending = this.pendingIntents.get(session)
    if (pending !== undefined) {
      return pending.active
    }
    return this.getLoggedActive(session)
  }

  /**
   * 获取会话已持久化记录的 Plan 模式状态
   */
  getLoggedActive(session: Session): boolean {
    const events = session.events
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === 'plan/mode') {
        return (events[i].data as any).active
      }
    }
    return false
  }

  /**
   * 获取当前会话完整的 Plan 状态
   */
  getState(session: Session): PlanState {
    const active = this.isActive(session)
    const logged = this.getLoggedActive(session)
    const pending = this.pendingIntents.has(session) && active !== logged
    return { active, pending }
  }

  /**
   * 设置 Plan 模式状态。
   * 若轮次处于开启中，放入 pending 队列等待下一个 Step 边界；
   * 若轮次未开启，立即原子追加到 SessionEventLog 中。
   */
  set(
    session: Session,
    active: boolean,
    reason: 'user_command' | 'plan_approved' | 'plan_off' = 'user_command'
  ): 'committed' | 'queued' {
    if (this.isTurnOpen(session)) {
      this.pendingIntents.set(session, { active, reason })
      return 'queued'
    } else {
      this.pendingIntents.delete(session)
      session.append('plan/mode', { active, reason })
      return 'committed'
    }
  }

  /**
   * 提交并落盘 pending 的状态变更
   */
  commitPending(session: Session): void {
    const pending = this.pendingIntents.get(session)
    if (pending === undefined) return
    this.pendingIntents.delete(session)
    const currentLogged = this.getLoggedActive(session)
    if (currentLogged !== pending.active) {
      session.append('plan/mode', { active: pending.active, reason: pending.reason })
    }
  }

  /**
   * 设置人机交互方案审核回调
   */
  setApprovalHandler(handler: PlanApprovalHandler): void {
    this.approvalHandler = handler
  }

  /**
   * 审核 exit_plan_mode 提交的方案
   */
  async reviewPlan(plan: string, session: Session): Promise<PlanApprovalDecision> {
    if (this.approvalHandler) {
      return await this.approvalHandler(plan, session)
    }
    if (this.config.autoApprove !== false) {
      return { approved: true }
    }
    throw new Error('No user approval channel available to review the plan. Use /plan off to exit manually.')
  }

  /**
   * 检查会话当前是否存在未结束的 Turn
   */
  isTurnOpen(session: Session): boolean {
    const events = session.events
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === 'turn/end') return false
      if (events[i].type === 'turn/start') return true
    }
    return false
  }
}

export default PlanModeController
