import { Context, Service } from 'cordis'
import type { Session } from '../session/index.js'
import type { PlanModeConfig, PlanApprovalDecision, PlanApprovalHandler, PlanState } from './types.js'

export const DEFAULT_PLAN_SECTION = `[PLAN MODE ACTIVE]
You are currently in PLAN MODE. Follow these rules strictly:
1. Explore the codebase and gather relevant context first.
2. Design a detailed, actionable approach and structure your work into concrete tasks using the \`todo_write\` tool.
3. Do NOT make file edits, modify code, or run destructive commands while in plan mode.
4. When your plan is ready, present your complete proposal using the \`exit_plan_mode\` tool. Your plan must be in Markdown format and start with a top-level heading (# Heading).
5. Once the plan is approved, plan mode will automatically exit and you can proceed with execution.`

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
