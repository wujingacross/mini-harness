import type { ContentBlock } from '../types/blocks.js'

export type CompactionTrigger = 'pressure' | 'context-overflow' | 'manual'

export interface CompactionConfig {
  /** 触发自动压缩的 Token 估算阈值（默认 8000） */
  thresholdTokens?: number
  /** 触发自动压缩的轮次阈值（默认 8 轮） */
  thresholdTurns?: number
  /** 压缩时保留的最近未折叠轮次数（默认 2 轮） */
  retainRecentTurns?: number
  /** 压缩时保留的最近未折叠估算 Token 数（默认 1500） */
  retainTokens?: number
  /** 摘要生成的最大 Token 上限（默认 800） */
  maxSummaryTokens?: number
  /** 摘要专用的模型名称（缺省时沿用 Agent 当前模型） */
  summarizationModel?: string
  /** 是否开启自动 Pre-step 压力检测与压缩（默认 true） */
  auto?: boolean
}

export interface CompactionResult {
  /** 压缩操作的唯一标识 */
  compactionId: string
  /** 写入 compaction/start 的日志序号 */
  startSeq: number
  /** 写入 compaction/summary 的日志序号 */
  summarySeq: number
  /** 写入 compaction/end 的日志序号 */
  endSeq: number
  /** 生成的结构化摘要内容块 */
  summary: ContentBlock[]
  /** 被遮蔽的历史事件序号跨度 */
  shadowedRange: { start: number; end: number }
  /** 被遮蔽的全部历史事件序号列表（单调递增） */
  shadowedSeqs: number[]
  /** 估算节约/被遮蔽的 Token 总数 */
  shadowedTokenCount: number
}
