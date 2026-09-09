import type { Context } from 'cordis'
import type { ContentBlock, Message } from '../types/blocks.js'

const SYSTEM_SUMMARIZE_PROMPT = `你是一个专业的对话上下文压缩助手。请将用户与智能体的多轮对话与工具执行历史总结为一份高度精炼、结构化的事实摘要。
请严格包含以下要点（使用清晰的 Markdown 列表）：
1. **核心任务目标**：用户的初衷、关键指令与期望产出；
2. **关键执行步骤与结论**：智能体执行了哪些工具/命令（如查看文件、运行测试、编辑代码），得到了什么关键输出或结论；
3. **涉及的关键文件**：明确列出读取、修改或新建的具体文件路径；
4. **当前进展与后续状态**：目前已完成的内容与下一步仍需推进的任务。
保持客观、准确、事实清晰，总字数控制在 300 字以内。`

function formatMessagesForSummarization(messages: Message[]): string {
  const parts: string[] = []
  for (const m of messages) {
    const roleName = m.role === 'user' ? '用户 (User)' : '智能体 (Assistant)'
    const textPieces: string[] = []
    for (const b of m.content) {
      if (b.type === 'text') {
        textPieces.push(b.text)
      } else if (b.type === 'tool-call') {
        textPieces.push(`[调用工具: ${b.name}, 参数: ${JSON.stringify(b.arguments)}]`)
      } else if (b.type === 'tool-result') {
        const preview = b.content.length > 500 ? b.content.slice(0, 500) + '... (截断)' : b.content
        textPieces.push(`[工具返回: ${b.isError ? '失败' : '成功'}, 输出: ${preview}]`)
      }
    }
    if (textPieces.length > 0) {
      parts.push(`${roleName}:\n${textPieces.join('\n')}`)
    }
  }
  return parts.join('\n\n---\n\n')
}

/**
 * 离线/测试/网络异常情况下的结构化后备摘要生成器
 */
export function generateFallbackSummary(messages: Message[]): string {
  const userGoals: string[] = []
  const toolsUsed = new Set<string>()
  const filesMentioned = new Set<string>()

  for (const m of messages) {
    for (const b of m.content) {
      if (b.type === 'text' && m.role === 'user') {
        userGoals.push(b.text.slice(0, 100))
      } else if (b.type === 'tool-call') {
        toolsUsed.add(b.name)
        const argsStr = JSON.stringify(b.arguments)
        const fileMatches = argsStr.match(/[\w\-./]+\.(?:ts|js|json|md|py|go|rs|html|css)/g)
        if (fileMatches) {
          for (const f of fileMatches) filesMentioned.add(f)
        }
      }
    }
  }

  const lines: string[] = [
    '### 前序会话上下文结构化摘要 (Compaction Summary)',
    `- **核心意图与指令**：${userGoals[0] || '多轮代码开发与任务交互'}`,
    `- **已调用工具**：${Array.from(toolsUsed).join(', ') || '无'}`,
  ]
  if (filesMentioned.size > 0) {
    lines.push(`- **涉及文件**：${Array.from(filesMentioned).join(', ')}`)
  }
  lines.push('- **当前状态**：早期会话已折叠压缩，保留关键上下文继续执行。')

  return lines.join('\n')
}

/**
 * 核心摘要生成入口：优先调用大语言模型进行高智能提炼，若失败或测试中无 Key，优雅回退至本地提取
 */
export async function summarizeHistory(
  ctx: Context,
  messages: Message[],
  model: string,
  signal?: AbortSignal,
): Promise<ContentBlock[]> {
  if (messages.length === 0) {
    return [{ type: 'text', text: '无前序会话历史。' }]
  }

  const transcript = formatMessagesForSummarization(messages)

  try {
    if (ctx.llm && typeof ctx.llm.stream === 'function') {
      const stream = ctx.llm.stream({
        model,
        systemPrompt: SYSTEM_SUMMARIZE_PROMPT,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: `请将以下历史交互压缩为紧凑摘要：\n\n${transcript}` }],
          },
        ],
        signal,
      })

      let summaryText = ''
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta') {
          summaryText += chunk.text
        }
      }

      if (summaryText.trim()) {
        return [{ type: 'text', text: summaryText.trim() }]
      }
    }
  } catch (err) {
    ctx.logger?.warn?.(`[Compaction] LLM 摘要生成异常，启用结构化后备摘要: ${err}`)
  }

  const fallbackText = generateFallbackSummary(messages)
  return [{ type: 'text', text: fallbackText }]
}
