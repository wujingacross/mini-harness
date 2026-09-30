export interface TodoItem {
  id?: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface TodoConfig {
  /**
   * 是否允许同时存在多个处于 in_progress 的任务。
   * 默认为 false（严格单任务顺序执行纪律，符合 deepseek-harness 规范）。
   */
  allowParallelInProgress?: boolean
}
