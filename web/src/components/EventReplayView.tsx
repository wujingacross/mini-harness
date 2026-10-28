import React, { useState, useMemo } from 'react'
import { useSession, type SessionEvent } from '../context/SessionContext'

type FilterCategory = 'all' | 'tools' | 'plans' | 'messages' | 'turns'

export const EventReplayView: React.FC = () => {
  const { events, currentSessionId } = useSession()
  const [filter, setFilter] = useState<FilterCategory>('all')
  const [expandedSeqs, setExpandedSeqs] = useState<Record<number, boolean>>({})

  const toggleExpand = (seq: number) => {
    setExpandedSeqs((prev) => ({ ...prev, [seq]: !prev[seq] }))
  }

  const expandAll = () => {
    const next: Record<number, boolean> = {}
    for (let i = 0; i < events.length; i++) {
      const seq = events[i].seq ?? i
      next[seq] = true
    }
    setExpandedSeqs(next)
  }

  const collapseAll = () => {
    setExpandedSeqs({})
  }

  const filteredEvents = useMemo(() => {
    return events.filter((evt) => {
      if (filter === 'all') return true
      if (filter === 'tools') return evt.type.startsWith('tool/')
      if (filter === 'plans') return evt.type.startsWith('plan/') || evt.type.startsWith('todo/')
      if (filter === 'messages') {
        return (
          evt.type === 'user/message' ||
          evt.type === 'assistant/message' ||
          evt.type === 'assistant/chunk' ||
          evt.type === 'context/message'
        )
      }
      if (filter === 'turns') {
        return evt.type.startsWith('turn/') || evt.type.startsWith('step/') || evt.type.startsWith('compaction/')
      }
      return true
    })
  }, [events, filter])

  const getEventBadgeStyle = (type: string) => {
    if (type.startsWith('tool/')) {
      return {
        bg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        icon: 'fa-screwdriver-wrench',
      }
    }
    if (type.startsWith('plan/') || type.startsWith('todo/')) {
      return {
        bg: 'bg-amber-50 text-amber-700 border-amber-200',
        icon: type.startsWith('todo/') ? 'fa-list-check' : 'fa-clipboard-check',
      }
    }
    if (type.startsWith('user/')) {
      return {
        bg: 'bg-blue-50 text-blue-700 border-blue-200',
        icon: 'fa-user',
      }
    }
    if (type.startsWith('assistant/')) {
      return {
        bg: 'bg-purple-50 text-purple-700 border-purple-200',
        icon: 'fa-robot',
      }
    }
    if (type.startsWith('compaction/')) {
      return {
        bg: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        icon: 'fa-box-archive',
      }
    }
    return {
      bg: 'bg-slate-50 text-slate-700 border-slate-200',
      icon: 'fa-cube',
    }
  }

  const renderSummary = (evt: SessionEvent) => {
    const data = evt.data as any
    if (evt.type === 'tool/call') {
      return (
        <span className="font-mono text-xs">
          调用 <strong className="text-slate-900">{data.name}</strong> (callId: {data.callId?.slice(-6)})
        </span>
      )
    }
    if (evt.type === 'tool/result') {
      return (
        <span className="font-mono text-xs">
          结果: {data.isError ? <span className="text-red-600 font-semibold">失败</span> : <span className="text-emerald-600 font-semibold">成功</span>} (callId: {data.callId?.slice(-6)})
        </span>
      )
    }
    if (evt.type === 'todo/write') {
      const todos = data.todos || []
      const done = todos.filter((t: any) => t.status === 'completed').length
      return (
        <span className="font-mono text-xs">
          全量置换待办列表 ({done}/{todos.length} 已完成)
        </span>
      )
    }
    if (evt.type === 'plan/mode') {
      return (
        <span className="font-mono text-xs">
          规划模式: <strong className={data.active ? 'text-amber-600' : 'text-slate-600'}>{data.active ? 'ACTIVE (开启)' : 'INACTIVE (关闭)'}</strong> (原因: {data.reason || 'none'})
        </span>
      )
    }
    if (evt.type === 'user/message') {
      const text = typeof data.content === 'string' ? data.content : data.content?.[0]?.text || ''
      return <span className="truncate max-w-md text-slate-700 text-xs">"{text.slice(0, 48)}{text.length > 48 ? '...' : ''}"</span>
    }
    if (evt.type === 'turn/start') {
      return <span className="text-xs text-slate-600">第 {data.turn} 轮会话开启</span>
    }
    if (evt.type === 'turn/end') {
      return <span className="text-xs text-slate-600">第 {data.turn} 轮会话闭合 (原因: {data.reason?.kind})</span>
    }
    if (evt.type === 'step/start') {
      return <span className="text-xs text-slate-500">Step {data.step} 启动</span>
    }
    if (evt.type === 'step/end') {
      return <span className="text-xs text-slate-500">Step {data.step} 结束</span>
    }
    return <span className="text-xs text-slate-500">{JSON.stringify(data).slice(0, 60)}</span>
  }

  const formatTime = (ts?: number) => {
    const d = new Date(ts || Date.now())
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50/50">
      {/* 轨迹回放控制栏 */}
      <div className="px-6 py-3 border-b border-slate-200 bg-white flex items-center justify-between shrink-0 select-none">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
            <i className="fa-solid fa-timeline text-blue-600"></i>
            <span>事件时间线回放 (Event Log Stream)</span>
          </div>
          <span className="text-[11px] text-slate-400 font-mono">
            {events.length} 个不可变日志事件 · Session: {currentSessionId}
          </span>
        </div>

        {/* 过滤切换标签 */}
        <div className="flex items-center gap-1.5">
          {[
            { id: 'all', label: '全部' },
            { id: 'tools', label: '工具调用' },
            { id: 'plans', label: '计划/待办' },
            { id: 'turns', label: '轮次/步骤' },
            { id: 'messages', label: '消息/推理' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setFilter(item.id as FilterCategory)}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition cursor-pointer ${
                filter === item.id
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
          <div className="h-3 w-[1px] bg-slate-200 mx-1"></div>
          <button
            onClick={expandAll}
            className="px-2 py-0.5 rounded text-[11px] text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition cursor-pointer"
            title="全部展开"
          >
            全部展开
          </button>
          <button
            onClick={collapseAll}
            className="px-2 py-0.5 rounded text-[11px] text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition cursor-pointer"
            title="全部收起"
          >
            全部收起
          </button>
        </div>
      </div>

      {/* 事件流回放主列表 */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2 select-text font-sans">
        {filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 select-none">
            <i className="fa-solid fa-list-check text-2xl mb-2"></i>
            <span className="text-xs">当前过滤器下暂无事件</span>
          </div>
        ) : (
          filteredEvents.map((evt, idx) => {
            const seq = evt.seq ?? idx
            const isExpanded = !!expandedSeqs[seq]
            const badge = getEventBadgeStyle(evt.type)

            return (
              <div
                key={seq}
                className="rounded-lg border border-slate-200 bg-white hover:border-slate-300 transition shadow-2xs overflow-hidden"
              >
                {/* 事件单行摘要 */}
                <div
                  onClick={() => toggleExpand(seq)}
                  className="px-3.5 py-2 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition select-none"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {/* Seq 序号 */}
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[10px] font-bold">
                      #{seq}
                    </span>

                    {/* 事件类型 Badge */}
                    <span
                      className={`px-2 py-0.5 rounded border text-[11px] font-mono font-medium flex items-center gap-1.5 ${badge.bg}`}
                    >
                      <i className={`fa-solid ${badge.icon} text-[10px]`}></i>
                      <span>{evt.type}</span>
                    </span>

                    {/* 概要描述 */}
                    <div className="truncate text-slate-700 min-w-0 flex items-center">
                      {renderSummary(evt)}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    <span className="font-mono text-[11px] text-slate-400">
                      {formatTime(evt.time)}
                    </span>
                    <i
                      className={`fa-solid fa-chevron-right text-[10px] text-slate-400 transition-transform ${
                        isExpanded ? 'rotate-90 text-slate-600' : ''
                      }`}
                    ></i>
                  </div>
                </div>

                {/* 展开的 Payload 详情 */}
                {isExpanded && (
                  <div className="px-3.5 py-2.5 bg-slate-900 border-t border-slate-200 text-slate-100 font-mono text-xs overflow-x-auto leading-relaxed">
                    <div className="text-[10px] text-slate-400 pb-1 mb-1 border-b border-slate-800 flex justify-between select-none">
                      <span>Event Payload (seq: {evt.seq}, time: {evt.time})</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          navigator.clipboard.writeText(JSON.stringify(evt.data, null, 2))
                        }}
                        className="hover:text-blue-400 transition cursor-pointer"
                        title="复制 Payload"
                      >
                        <i className="fa-regular fa-copy"></i> 复制 JSON
                      </button>
                    </div>
                    <pre className="text-[11px] leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto">
                      {JSON.stringify(evt.data, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
