import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useSession } from '../context/SessionContext'
import { MarkdownView } from './MarkdownView'

interface ToolCallItem {
  id: string
  name: string
  args: any
  status: 'running' | 'completed' | 'failed'
  result?: any
}

interface TimelineItem {
  kind: 'user' | 'think' | 'tool' | 'text' | 'error' | 'compaction'
  id: string
  content?: string
  tool?: ToolCallItem
  compactionData?: {
    compactionId: string
    shadowedSeqsCount: number
    shadowedRange: { start: number; end: number }
    shadowedTokenCount: number
    summary: string
  }
}

/**
 * MessageActionToolbar: 对齐官方 ui-message-feedback (Red Box 4)
 * 包含：复制 (Copy)、好评 (Like)、差评 (Dislike)、重试 / 分支 (Retry)
 */
const MessageActionToolbar: React.FC<{ content: string }> = ({ content }) => {
  const [copied, setCopied] = useState(false)
  const [liked, setLiked] = useState(false)
  const [disliked, setDisliked] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="inline-flex items-center gap-0.5 mt-2.5 px-1 py-0.5 rounded-lg border border-slate-200 bg-white text-slate-400 text-xs shadow-2xs select-none">
      <button
        onClick={handleCopy}
        className="w-6 h-6 rounded flex items-center justify-center hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
        title={copied ? '已复制' : '复制回答'}
      >
        <i className={copied ? 'fa-solid fa-check text-green-600 text-[11px]' : 'fa-regular fa-copy text-[11px]'}></i>
      </button>

      <button
        onClick={() => {
          setLiked(!liked)
          if (!liked) setDisliked(false)
        }}
        className={`w-6 h-6 rounded flex items-center justify-center hover:bg-slate-100 transition cursor-pointer ${
          liked ? 'text-blue-600' : 'hover:text-slate-700'
        }`}
        title="好评"
      >
        <i className="fa-regular fa-thumbs-up text-[11px]"></i>
      </button>

      <button
        onClick={() => {
          setDisliked(!disliked)
          if (!disliked) setLiked(false)
        }}
        className={`w-6 h-6 rounded flex items-center justify-center hover:bg-slate-100 transition cursor-pointer ${
          disliked ? 'text-red-500' : 'hover:text-slate-700'
        }`}
        title="差评"
      >
        <i className="fa-regular fa-thumbs-down text-[11px]"></i>
      </button>

      <button
        className="w-6 h-6 rounded flex items-center justify-center hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
        title="重试 / 分支"
      >
        <i className="fa-solid fa-arrow-rotate-right text-[10px]"></i>
      </button>
    </div>
  )
}

export const TrajectoryStream: React.FC = () => {
  const { events, activeTab, sendPrompt, isRunning, telemetry } = useSession()
  const streamEndRef = useRef<HTMLDivElement | null>(null)
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({})

  const toggleToolExpand = (toolId: string) => {
    setExpandedTools((prev) => ({ ...prev, [toolId]: !prev[toolId] }))
  }

  const items = useMemo(() => {
    const list: TimelineItem[] = []
    const toolMap = new Map<string, ToolCallItem>()

    // 1. Identify which turn/step already have finalized assistant/message
    const finalizedSteps = new Set<string>()
    for (const evt of events) {
      if (evt.type === 'assistant/message') {
        const key = `${evt.data.turn}_${evt.data.step}`
        finalizedSteps.add(key)
      }
    }

    // Streaming buffers for in-progress step
    let streamingThink = ''
    let streamingText = ''

    const flushStreamingThink = () => {
      if (streamingThink) {
        list.push({ kind: 'think', id: `stream_think_${list.length}`, content: streamingThink })
        streamingThink = ''
      }
    }

    const flushStreamingText = () => {
      if (streamingText) {
        list.push({ kind: 'text', id: `stream_text_${list.length}`, content: streamingText })
        streamingText = ''
      }
    }

    for (const evt of events) {
      if (evt.type === 'user/message') {
        flushStreamingThink()
        flushStreamingText()

        let userText = ''
        if (typeof evt.data.content === 'string') {
          userText = evt.data.content
        } else if (Array.isArray(evt.data.content)) {
          userText = evt.data.content.map((c: any) => (typeof c === 'string' ? c : c.text || '')).join('\n')
        } else if (evt.data.content?.text) {
          userText = evt.data.content.text
        }

        list.push({ kind: 'user', id: `user_${list.length}`, content: userText })
      } else if (evt.type === 'assistant/chunk') {
        const key = `${evt.data.turn}_${evt.data.step}`
        if (!finalizedSteps.has(key)) {
          const chunk = evt.data.chunk
          if (chunk.type === 'reasoning-delta' || chunk.kind === 'reasoning') {
            streamingThink += chunk.text
          } else if (chunk.type === 'text-delta' || chunk.kind === 'text') {
            flushStreamingThink()
            streamingText += chunk.text
          }
        }
      } else if (evt.type === 'tool/call') {
        const key = `${evt.data.turn}_${evt.data.step}`
        const callId = evt.data.callId || evt.data.id || `tool_${list.length}`
        if (!toolMap.has(callId)) {
          const item: ToolCallItem = {
            id: callId,
            name: evt.data.name,
            args: evt.data.arguments || {},
            status: 'running',
          }
          toolMap.set(callId, item)

          if (!finalizedSteps.has(key)) {
            flushStreamingThink()
            flushStreamingText()
            list.push({ kind: 'tool', id: callId, tool: item })
          }
        }
      } else if (evt.type === 'tool/result') {
        const callId = evt.data.callId
        const item = toolMap.get(callId)
        if (item) {
          item.status = evt.data.isError ? 'failed' : 'completed'
          item.result = evt.data.content
        }
      } else if (evt.type === 'assistant/message') {
        flushStreamingThink()
        flushStreamingText()

        for (const block of evt.data.content || []) {
          if (block.type === 'reasoning') {
            list.push({ kind: 'think', id: `think_${list.length}`, content: block.text })
          } else if (block.type === 'text') {
            list.push({ kind: 'text', id: `text_${list.length}`, content: block.text })
          } else if (block.type === 'tool-call') {
            let item = toolMap.get(block.id)
            if (!item) {
              item = {
                id: block.id,
                name: block.name,
                args: block.arguments || {},
                status: 'completed',
              }
              toolMap.set(block.id, item)
            }
            list.push({ kind: 'tool', id: block.id, tool: item })
          }
        }
      } else if (evt.type === 'compaction/summary') {
        flushStreamingThink()
        flushStreamingText()
        const summaryText = evt.data.summary?.map((b: any) => b.text || '').join('\n') || ''
        list.push({
          kind: 'compaction',
          id: `compact_${evt.seq ?? list.length}`,
          compactionData: {
            compactionId: evt.data.compactionId,
            shadowedSeqsCount: evt.data.shadowedSeqs?.length || 0,
            shadowedRange: evt.data.shadowedRange || { start: 0, end: 0 },
            shadowedTokenCount: evt.data.shadowedTokenCount || 0,
            summary: summaryText,
          },
        })
      } else if (evt.type === 'turn/end' && evt.data?.reason?.kind === 'error') {
        flushStreamingThink()
        flushStreamingText()
        list.push({
          kind: 'error',
          id: `error_${list.length}`,
          content: evt.data.reason.message || '模型调用执行失败',
        })
      }
    }

    flushStreamingThink()
    flushStreamingText()
    return list
  }, [events])

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [items])

  const visibleItems = useMemo(() => {
    if (activeTab === 'trajectory') {
      return items.filter((it) => it.kind === 'think' || it.kind === 'tool' || it.kind === 'compaction')
    }
    return items
  }, [items, activeTab])

  return (
    <div className="flex-1 overflow-y-auto px-16 py-8 space-y-2 max-w-4xl w-full mx-auto select-text font-sans flex flex-col justify-start">
      {visibleItems.length === 0 ? (
        <div className="my-auto flex flex-col items-center justify-center py-16 text-center select-none">
          {/* DeepSeek Whale Logo */}
          <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-lg mb-4 shadow-blue-500/20">
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-1.5 tracking-tight">DeepSeek Harness</h2>
          <p className="text-xs text-slate-500 max-w-md mb-8 leading-relaxed">
            基于 Cordis 微内核架构的智能编程 Agent，具备自主代码编写、文件浏览、工具调度与测试验证能力。
          </p>

          {/* Quick Prompt Pills */}
          <div className="flex flex-col sm:flex-row gap-2.5 max-w-xl w-full justify-center">
            {[
              { icon: 'fa-folder-tree', text: '检查当前工作区的目录结构与核心文件' },
              { icon: 'fa-code', text: '编写一个快速排序并添加单元测试' },
              { icon: 'fa-vial-circle-check', text: '运行现有测试套件并分析测试结果' },
            ].map((pill, idx) => (
              <button
                key={idx}
                onClick={() => sendPrompt(pill.text)}
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white hover:border-blue-400 hover:bg-blue-50/40 text-slate-700 text-xs font-medium transition text-left shadow-2xs cursor-pointer group"
              >
                <i className={`fa-solid ${pill.icon} text-slate-400 group-hover:text-blue-600 transition`}></i>
                <span className="truncate">{pill.text}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        visibleItems.map((item) => {
          if (item.kind === 'user') {
            return (
              <div
                key={item.id}
                className="flex items-baseline gap-2 pt-6 pb-2.5 border-b border-slate-100 mb-2 font-semibold text-slate-900"
              >
                <span className="text-blue-600 text-sm">
                  <i className="fa-solid fa-circle-user"></i>
                </span>
                <span className="text-blue-600 font-bold text-sm">User</span>
                <span className="text-slate-300">·</span>
                <span className="text-slate-900 font-normal text-sm whitespace-pre-wrap leading-relaxed">
                  {item.content}
                </span>
              </div>
            )
          }

          if (item.kind === 'think') {
            return (
              <div
                key={item.id}
                className="flex items-baseline gap-2 py-0.5 text-[13px] text-slate-500 font-normal leading-relaxed"
              >
                <span className="text-slate-400 shrink-0 text-xs">⬡</span>
                <span className="text-slate-600 font-medium">Think</span>
                <span className="text-slate-300">·</span>
                <span className="text-slate-500 whitespace-pre-wrap leading-relaxed">{item.content}</span>
              </div>
            )
          }

          if (item.kind === 'tool' && item.tool) {
            const tool = item.tool
            const isExpanded = !!expandedTools[item.id]
            let icon = 'fa-terminal'
            let label = 'Tool'
            let paramText = ''

            if (tool.name === 'view_file' || tool.name === 'read_file') {
              icon = 'fa-file-lines'
              label = 'Read'
              paramText = tool.args?.path || tool.args?.AbsolutePath || ''
            } else if (tool.name === 'replace_file_content' || tool.name === 'edit_file') {
              icon = 'fa-pen-to-square'
              label = 'Edit'
              paramText = tool.args?.path || tool.args?.TargetFile || ''
            } else if (tool.name === 'write_to_file') {
              icon = 'fa-file-circle-plus'
              label = 'Write'
              paramText = tool.args?.path || tool.args?.TargetFile || ''
            } else if (tool.name === 'find_by_name') {
              icon = 'fa-magnifying-glass'
              label = 'Glob'
              paramText = tool.args?.pattern || tool.args?.Pattern || ''
            } else if (tool.name === 'grep_search') {
              icon = 'fa-magnifying-glass'
              label = 'Grep'
              paramText = tool.args?.query || tool.args?.Query || ''
            } else if (tool.name === 'bash') {
              icon = 'fa-terminal'
              label = 'Bash'
              paramText = tool.args?.command || tool.args?.CommandLine || ''
            }

            return (
              <div key={item.id} className="py-0.5">
                <div
                  onClick={() => toggleToolExpand(item.id)}
                  className="flex items-center gap-2 py-1 px-2 rounded-md hover:bg-slate-100/80 cursor-pointer text-[13px] text-slate-700 leading-relaxed font-normal transition select-none"
                >
                  <i
                    className={`fa-solid fa-chevron-right text-[9px] text-slate-400 transition-transform ${
                      isExpanded ? 'rotate-90 text-slate-600' : ''
                    }`}
                  ></i>
                  <span className="text-slate-400 shrink-0 text-xs">
                    <i className={`fa-solid ${icon}`}></i>
                  </span>
                  <span className="text-slate-800 font-medium">{label}</span>
                  <span className="text-slate-300">·</span>
                  <span
                    className={`font-mono text-xs text-slate-900 truncate max-w-md ${
                      paramText.includes('/') ? 'hover:underline' : ''
                    }`}
                  >
                    {paramText || tool.name}
                  </span>
                  {tool.status === 'running' && (
                    <span className="ml-auto text-[10px] text-blue-500 font-normal flex items-center gap-1">
                      <i className="fa-solid fa-circle-notch fa-spin text-[9px]"></i>
                      <span>执行中...</span>
                    </span>
                  )}
                  {tool.status === 'failed' && (
                    <span className="ml-auto text-[10px] text-red-500 font-medium">失败</span>
                  )}
                  {tool.status === 'completed' && (
                    <span className="ml-auto text-[10px] text-slate-400 font-normal">完成</span>
                  )}
                </div>

                {isExpanded && (
                  <div className="mt-1.5 ml-6 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono space-y-2 select-text">
                    <div>
                      <div className="text-[10px] font-sans font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        参数 (Arguments)
                      </div>
                      <pre className="bg-white p-2 rounded border border-slate-200 text-[11px] text-slate-800 overflow-x-auto max-h-48 leading-relaxed whitespace-pre-wrap">
                        {JSON.stringify(tool.args, null, 2)}
                      </pre>
                    </div>

                    <div>
                      <div className="text-[10px] font-sans font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        输出结果 (Result)
                      </div>
                      {tool.status === 'running' ? (
                        <div className="text-[11px] text-slate-400 italic">正在等待工具返回结果...</div>
                      ) : (
                        <pre className="bg-white p-2 rounded border border-slate-200 text-[11px] text-slate-800 overflow-x-auto max-h-60 leading-relaxed whitespace-pre-wrap">
                          {typeof tool.result === 'string'
                            ? tool.result
                            : JSON.stringify(tool.result, null, 2) || '(无输出)'}
                        </pre>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          }

          if (item.kind === 'text' && item.content) {
            return (
              <div key={item.id} className="py-2.5 my-1 text-slate-900">
                <MarkdownView content={item.content} />
                {/* Red Box 4: Message Actions Toolbar */}
                <MessageActionToolbar content={item.content} />
              </div>
            )
          }

          if (item.kind === 'error') {
            return (
              <div
                key={item.id}
                className="my-3 p-3.5 rounded-xl border border-red-200 bg-red-50/90 text-red-700 text-xs flex items-start gap-2.5 shadow-2xs select-text"
              >
                <i className="fa-solid fa-triangle-exclamation text-red-500 text-sm shrink-0 mt-0.5"></i>
                <div className="flex-1 space-y-1">
                  <div className="font-semibold text-[13px] text-red-800">请求失败 / 模型接口异常</div>
                  <div className="text-[12px] font-mono leading-relaxed whitespace-pre-wrap text-red-700">
                    {item.content}
                  </div>
                </div>
              </div>
            )
          }

          if (item.kind === 'compaction' && item.compactionData) {
            const data = item.compactionData
            const isExpanded = !!expandedTools[item.id]
            return (
              <div
                key={item.id}
                className="my-3 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50/90 to-indigo-50/70 p-3 text-xs text-blue-900 shadow-2xs transition select-none"
              >
                <div
                  onClick={() => toggleToolExpand(item.id)}
                  className="flex items-center justify-between cursor-pointer"
                >
                  <div className="flex items-center gap-2 font-medium">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-blue-600 text-white text-[10px]">
                      <i className="fa-solid fa-box-archive"></i>
                    </span>
                    <span className="font-semibold text-blue-950">历史上下文已压缩 (Compaction)</span>
                    <span className="rounded bg-blue-100/80 px-1.5 py-0.5 text-[10px] font-mono text-blue-700">
                      折叠 {data.shadowedSeqsCount} 条事件 · 释放 ~{data.shadowedTokenCount} tokens
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-blue-600 hover:text-blue-800 font-medium">
                    <span>{isExpanded ? '收起摘要' : '查看压缩摘要'}</span>
                    <i
                      className={`fa-solid fa-chevron-right text-[9px] transition-transform ${
                        isExpanded ? 'rotate-90' : ''
                      }`}
                    ></i>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-2.5 pt-2.5 border-t border-blue-200/60 font-sans text-slate-700 select-text leading-relaxed">
                    <MarkdownView content={data.summary} />
                  </div>
                )}
              </div>
            )
          }

          return null
        })
      )}
      {isRunning && (
        <div className="flex items-center gap-2.5 py-2 px-3.5 my-2 rounded-xl bg-blue-50/80 border border-blue-100 text-xs text-blue-700 select-none animate-pulse w-max">
          <i className="fa-solid fa-circle-notch fa-spin text-blue-600 text-xs"></i>
          <span className="font-medium">
            智能体正在思考与执行循环 (第 {telemetry.turns || 1} 轮 · 第 {telemetry.steps || 1} 步)...
          </span>
        </div>
      )}
      <div ref={streamEndRef} />
    </div>
  )
}
