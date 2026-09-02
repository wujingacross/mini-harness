import React, { useEffect, useRef, useMemo } from 'react'
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

export const TrajectoryStream: React.FC = () => {
  const { events } = useSession()
  const streamEndRef = useRef<HTMLDivElement | null>(null)

  const items = useMemo(() => {
    const list: TimelineItem[] = []
    const toolMap = new Map<string, ToolCallItem>()
    let currentThinkText = ''
    let currentAssistantText = ''

    const flushThink = () => {
      if (currentThinkText) {
        list.push({ kind: 'think', id: `think_${list.length}`, content: currentThinkText })
        currentThinkText = ''
      }
    }

    const flushText = () => {
      if (currentAssistantText) {
        list.push({ kind: 'text', id: `text_${list.length}`, content: currentAssistantText })
        currentAssistantText = ''
      }
    }

    for (const evt of events) {
      if (evt.type === 'user/message') {
        flushThink()
        flushText()
        const text = evt.data.content?.[0]?.text || ''
        list.push({ kind: 'user', id: `user_${list.length}`, content: text })
      } else if (evt.type === 'assistant/chunk') {
        const chunk = evt.data.chunk
        if (chunk.type === 'reasoning-delta' || chunk.kind === 'reasoning') {
          currentThinkText += chunk.text
        } else if (chunk.type === 'text-delta' || chunk.kind === 'text') {
          flushThink()
          currentAssistantText += chunk.text
        }
      } else if (evt.type === 'tool/call') {
        flushThink()
        flushText()
        const callId = evt.data.callId || evt.data.id || `tool_${list.length}`
        const item: ToolCallItem = {
          id: callId,
          name: evt.data.name,
          args: evt.data.arguments || {},
          status: 'running',
        }
        toolMap.set(callId, item)
        list.push({ kind: 'tool', id: callId, tool: item })
      } else if (evt.type === 'tool/result') {
        const callId = evt.data.callId
        const item = toolMap.get(callId)
        if (item) {
          item.status = evt.data.isError ? 'failed' : 'completed'
          item.result = evt.data.content
        }
      } else if (evt.type === 'assistant/message') {
        // Materialized assistant message
        flushThink()
        flushText()
        for (const block of evt.data.content || []) {
          if (block.type === 'reasoning') {
            list.push({ kind: 'think', id: `think_${list.length}`, content: block.text })
          } else if (block.type === 'text') {
            list.push({ kind: 'text', id: `text_${list.length}`, content: block.text })
          } else if (block.type === 'tool-call') {
            if (!toolMap.has(block.id)) {
              const item: ToolCallItem = {
                id: block.id,
                name: block.name,
                args: block.arguments || {},
                status: 'completed',
              }
              toolMap.set(block.id, item)
              list.push({ kind: 'tool', id: block.id, tool: item })
            }
          }
        }
      } else if (evt.type === 'turn/end') {
        flushThink()
        flushText()
      }
    }

    flushThink()
    flushText()
    return list
  }, [events])

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [items])

  return (
    <div className="flex-1 overflow-y-auto px-16 py-6 space-y-3 max-w-4xl w-full mx-auto select-text">
      {items.map((item) => {
        if (item.kind === 'user') {
          return (
            <div
              key={item.id}
              className="trajectory-row pt-4 pb-2 border-b border-slate-100 font-semibold text-slate-900"
            >
              <span className="trajectory-icon text-blue-600">
                <i className="fa-solid fa-circle-user text-sm"></i>
              </span>
              <span className="trajectory-type text-blue-600 font-bold">User</span>
              <span className="trajectory-sep">·</span>
              <span className="text-slate-900 font-normal leading-relaxed whitespace-pre-wrap">
                {item.content}
              </span>
            </div>
          )
        }

        if (item.kind === 'think') {
          return (
            <div key={item.id} className="trajectory-row trajectory-think-row text-xs text-slate-500">
              <span className="trajectory-icon">
                <i className="fa-solid fa-cube text-[11px] text-slate-400"></i>
              </span>
              <span className="trajectory-type text-slate-600">Think</span>
              <span className="trajectory-sep">·</span>
              <span className="trajectory-content whitespace-pre-wrap">{item.content}</span>
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
            <div key={item.id} className="trajectory-row select-none py-0.5">
              <span className="trajectory-icon">
                <i className={`fa-solid ${icon} text-[11px]`}></i>
              </span>
              <span className="trajectory-type">{label}</span>
              <span className="trajectory-sep">·</span>
              <span
                className={`trajectory-content font-mono text-xs ${
                  paramText.includes('/') ? 'trajectory-path' : ''
                }`}
              >
                {paramText || tool.name}
              </span>
              {tool.status === 'running' && (
                <span className="status-indicator ml-auto text-[10px] text-slate-400 font-normal">
                  运行中...
                </span>
              )}
              {tool.status === 'failed' && (
                <span className="status-indicator ml-auto text-[10px] text-red-500 font-medium">
                  失败
                </span>
              )}
            </div>
          )
        }

        if (item.kind === 'text' && item.content) {
          return (
            <div key={item.id} className="py-2 my-1.5">
              <MarkdownView content={item.content} />
            </div>
          )
        }

        return null
      })}
      <div ref={streamEndRef} />
    </div>
  )
}
