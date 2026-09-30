import type { Session } from '../session/index.js'

export interface PlanModeConfig {
  /**
   * 当 Plan 模式激活时动态注入系统提示词的引导文本
   */
  section?: string
  /**
   * 是否在调用 exit_plan_mode 时自动批准（常用于测试与无头自动化模式）
   * 默认为 true（在无 Web 审核交互挂载时自动批准）
   */
  autoApprove?: boolean
}

export type PlanApprovalDecision =
  | { approved: true }
  | { approved: false; feedback?: string }

export type PlanApprovalHandler = (plan: string, session: Session) => Promise<PlanApprovalDecision>

export interface PlanState {
  active: boolean
  pending: boolean
}
