import { Context } from 'cordis'
import { PlanModeController } from './engine.js'
import { createExitPlanModeTool } from './tools.js'
import type { PlanModeConfig } from './types.js'

export * from './types.js'
export * from './engine.js'
export * from './tools.js'

export const name = 'plan-mode'
export const inject = ['systemPrompt', 'tools', 'sessions']

export function apply(ctx: Context, config: PlanModeConfig = {}): void {
  ctx.plugin(PlanModeController, config)
  ctx.tools.register(createExitPlanModeTool(ctx))
}

export default {
  name,
  inject,
  apply,
}
