import type { Context } from 'cordis'
import type { ToolDefinition, ToolExecution } from '../tools/index.js'
import type { Session } from '../session/index.js'

export const EXIT_PLAN_MODE = 'exit_plan_mode'

export function createExitPlanModeTool(ctx: Context): ToolDefinition<{ plan: string }> {
  return {
    name: EXIT_PLAN_MODE,
    description:
      'Use only in plan mode. Present your plan for user review and, on approval, leave plan mode. ' +
      'Send the COMPLETE plan as markdown, starting with a # heading that names it. ' +
      'The user may approve (carry out the plan from your next step) or keep planning — their feedback comes back in the tool result; revise and present again.',
    parameters: {
      type: 'object',
      properties: {
        plan: {
          type: 'string',
          description: 'The complete plan, as markdown, starting with a # heading that names it.',
        },
      },
      required: ['plan'],
    },
    async execute(args: { plan: string }, exec?: ToolExecution): Promise<string> {
      const session = exec?.session
      if (!session) {
        throw new Error(`${EXIT_PLAN_MODE} requires an active session`)
      }
      const planMode = ctx.get('planMode')
      if (!planMode || !planMode.isActive(session)) {
        throw new Error(`${EXIT_PLAN_MODE} is only available in plan mode`)
      }
      const plan = (args.plan || '').trim()
      if (!/^#\s+\S/.test(plan)) {
        throw new Error(`${EXIT_PLAN_MODE} requires a non-empty markdown plan starting with a # heading`)
      }

      const decision = await planMode.reviewPlan(plan, session)
      if (decision.approved) {
        planMode.set(session, false, 'plan_approved')
        return 'Plan approved — plan mode exited; carry out the plan starting with your next step.'
      } else {
        const feedback = decision.feedback?.trim()
        if (feedback) {
          throw new Error(`The user chose to keep planning; their feedback: ${feedback}`)
        } else {
          throw new Error('The user chose to keep planning; revise the plan and present it again.')
        }
      }
    },
  }
}
