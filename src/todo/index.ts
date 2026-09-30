import { Context } from 'cordis'
import { createTodoWriteTool } from './tool.js'
import type { TodoConfig } from './types.js'

export * from './types.js'
export * from './tool.js'

export const name = 'tool-todo'
export const inject = ['tools']

export function apply(ctx: Context, config: TodoConfig = {}): void {
  ctx.tools.register(createTodoWriteTool(config))
}

export default {
  name,
  inject,
  apply,
}
