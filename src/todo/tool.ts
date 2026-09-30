import type { ToolDefinition, ToolExecution } from '../tools/index.js'
import type { Session } from '../session/index.js'
import type { TodoConfig, TodoItem } from './types.js'

export const VALID_STATUSES = ['pending', 'in_progress', 'completed'] as const

export function createTodoWriteTool(config: TodoConfig = {}): ToolDefinition<{ todos: TodoItem[] }> {
  const allowParallel = config.allowParallelInProgress ?? false

  const description =
    'Record and update a structured task list for the current work. Send the ENTIRE list every call — it REPLACES the previous list (there are no partial updates, no per-item edits). Use it to plan multi-step work and show progress: add one todo per concrete step before you start. ' +
    (allowParallel
      ? 'Mark every todo being actively worked on `in_progress` — several at once when work genuinely runs in parallel. '
      : 'Keep AT MOST ONE todo `in_progress` at a time; while work remains, exactly one active task should be `in_progress`. ') +
    'Mark a todo `completed` the moment it is done (do not batch completions). Skip the list for trivial single-step tasks. Statuses: `pending` (not started), `in_progress` (being worked on now), `completed` (finished).'

  return {
    name: 'todo_write',
    description,
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'The COMPLETE task list, replacing any previous list.',
          items: {
            type: 'object',
            properties: {
              content: {
                type: 'string',
                description: 'What the task is — a short imperative line.',
              },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
                description: 'Task status: pending, in_progress, or completed.',
              },
            },
            required: ['content', 'status'],
          },
        },
      },
      required: ['todos'],
    },
    async execute(args: { todos: TodoItem[] }, exec?: ToolExecution): Promise<string> {
      const session = exec?.session
      if (!session) {
        throw new Error('todo_write requires an active session')
      }

      if (!Array.isArray(args.todos)) {
        throw new Error('invalid todos: `todos` must be an array')
      }

      const validated: TodoItem[] = []
      const seen = new Set<string>()
      let inProgressCount = 0

      for (let i = 0; i < args.todos.length; i++) {
        const item = args.todos[i]
        if (!item || typeof item !== 'object') {
          throw new Error(`invalid todo at index ${i}: item must be an object`)
        }

        const content = (item.content || '').trim()
        if (content.length === 0) {
          throw new Error(`invalid todo at index ${i}: \`content\` must be a non-empty string`)
        }

        if (seen.has(content)) {
          throw new Error(`invalid todos: duplicate content "${content}"`)
        }
        seen.add(content)

        if (!VALID_STATUSES.includes(item.status as any)) {
          throw new Error(`invalid todo at index ${i}: unknown status "${item.status}"`)
        }

        if (item.status === 'in_progress') {
          inProgressCount++
        }

        validated.push({
          id: item.id || `todo-${i + 1}`,
          content,
          status: item.status,
        })
      }

      if (!allowParallel && inProgressCount > 1) {
        throw new Error(`invalid todos: at most one task may be in_progress (got ${inProgressCount})`)
      }

      session.append('todo/write', { todos: validated })

      const pendingCount = validated.filter(t => t.status === 'pending').length
      const completedCount = validated.filter(t => t.status === 'completed').length

      return `Updated todo list: ${pendingCount} pending, ${inProgressCount} in progress, ${completedCount} completed.`
    },
  }
}

/**
 * 纯函数：从会话事件溯源流中恢复当前的 Todo 任务快照
 */
export function deriveTodos(session: Session): TodoItem[] {
  const events = session.events
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'todo/write') {
      return (events[i].data as any).todos || []
    }
  }
  return []
}
