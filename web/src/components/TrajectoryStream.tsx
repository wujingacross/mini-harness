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
  kind: 'user' | 'think' | 'tool' | 'text'
  id: string
  content?: string
  tool?: ToolCallItem
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
  const { events, activeTab } = useSession()
  const streamEndRef = useRef<HTMLDivElement | null>(null)

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
      return items.filter((it) => it.kind === 'think' || it.kind === 'tool')
    }
    return items
  }, [items, activeTab])

  return (
    <div className="flex-1 overflow-y-auto px-16 py-8 space-y-2 max-w-4xl w-full mx-auto select-text font-sans">
      {visibleItems.map((item) => {
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
          let icon = 'fa-terminal'
          let label = 'Tool'
          let paramText = ''

          if (tool.name === 'view_file' || tool.name === 'read_file') {
            icon = 'fa-file-lines'
            label = 'Read'
            paramText = tool.args?.path || ''
          } else if (tool.name === 'replace_file_content' || tool.name === 'edit_file') {
            icon = 'fa-pen-to-square'
            label = 'Edit'
            paramText = tool.args?.path || ''
          } else if (tool.name === 'write_to_file') {
            icon = 'fa-file-circle-plus'
            label = 'Write'
            paramText = tool.args?.path || ''
          } else if (tool.name === 'find_by_name') {
            icon = 'fa-magnifying-glass'
            label = 'Glob'
            paramText = tool.args?.pattern || ''
          } else if (tool.name === 'grep_search') {
            icon = 'fa-magnifying-glass'
            label = 'Grep'
            paramText = tool.args?.query || ''
          } else if (tool.name === 'bash') {
            icon = 'fa-terminal'
            label = 'Bash'
            paramText = tool.args?.command || ''
          }

          return (
            <div key={item.id} className="flex items-baseline gap-2 py-0.5 text-[13px] text-slate-700 leading-relaxed font-normal">
              <span className="text-slate-400 shrink-0 text-xs">
                <i className={`fa-solid ${icon}`}></i>
              </span>
              <span className="text-slate-800 font-medium">{label}</span>
              <span className="text-slate-300">·</span>
              <span
                className={`font-mono text-xs text-slate-900 ${
                  paramText.includes('/') ? 'hover:underline cursor-pointer' : ''
                }`}
              >
                {paramText || tool.name}
              </span>
              {tool.status === 'running' && (
                <span className="ml-auto text-[10px] text-slate-400 font-normal">运行中...</span>
              )}
              {tool.status === 'failed' && (
                <span className="ml-auto text-[10px] text-red-500 font-medium">失败</span>
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

        return null
      })}
      <div ref={streamEndRef} />
    </div>
  )
}
