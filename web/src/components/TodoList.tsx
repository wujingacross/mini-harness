import React, { useState } from 'react'
import { useSession } from '../context/SessionContext'

export const TodoList: React.FC = () => {
  const { todos, planState, togglePlanMode, isRunning } = useSession()
  const [collapsed, setCollapsed] = useState(false)

  if (todos.length === 0 && !planState.active) {
    return null
  }

  const completedCount = todos.filter((t) => t.status === 'completed').length
  const inProgressCount = todos.filter((t) => t.status === 'in_progress').length
  const pendingCount = todos.filter((t) => t.status === 'pending').length
  const totalCount = todos.length
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  return (
    <div className="w-full max-w-4xl mx-auto px-6 sm:px-16 pt-3 pb-1 select-none shrink-0">
      <div className="rounded-xl border border-slate-200 bg-white/95 backdrop-blur-xs p-3.5 shadow-2xs text-[13px] transition-all">
        {/* Header bar */}
        <div
          className="flex items-center justify-between cursor-pointer select-none"
          onClick={() => {
            setCollapsed(!collapsed)
          }}
        >
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-blue-50 text-blue-600 text-xs border border-blue-100">
              <i className="fa-solid fa-list-check"></i>
            </span>
            <span className="font-semibold text-slate-800">任务规划与执行清单</span>
            {planState.active && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-bold tracking-wide">
                PLAN MODE
              </span>
            )}
            {totalCount > 0 && (
              <span className="text-xs text-slate-500 font-mono">
                ({completedCount}/{totalCount} 完成 · {progressPercent}%)
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {planState.active && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  togglePlanMode(false)
                }}
                className="px-2.5 py-1 text-[11px] font-medium text-rose-600 bg-white hover:bg-rose-50 border border-rose-200 rounded-md transition cursor-pointer shadow-2xs"
                title="退出规划模式"
              >
                退出规划模式 (/plan off)
              </button>
            )}
            <span className="text-slate-400 hover:text-slate-600 text-xs flex items-center gap-1 transition">
              <span>{collapsed ? '展开' : '收起'}</span>
              <i
                className={`fa-solid fa-chevron-down text-[10px] transition-transform duration-200 ${
                  collapsed ? '-rotate-90' : ''
                }`}
              ></i>
            </span>
          </div>
        </div>

        {/* Progress Bar */}
        {totalCount > 0 && !collapsed && (
          <div className="mt-2.5 mb-2 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200/50">
            <div
              className={`h-full rounded-full transition-all duration-300 ease-out ${
                progressPercent === 100 ? 'bg-emerald-500' : 'bg-blue-600'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}

        {/* Task List */}
        {!collapsed && totalCount > 0 && (
          <div className="mt-2.5 max-h-56 overflow-y-auto space-y-1.5 pr-1">
            {todos.map((todo, idx) => {
              const isCompleted = todo.status === 'completed'
              const isInProgress = todo.status === 'in_progress'

              return (
                <div
                  key={todo.id || idx}
                  className={`flex items-start gap-2.5 px-2.5 py-1.5 rounded-lg text-xs transition leading-relaxed ${
                    isInProgress
                      ? isRunning
                        ? 'bg-blue-50/70 border border-blue-200/70 text-blue-900'
                        : 'bg-amber-50/40 border border-amber-200/60 text-slate-800'
                      : isCompleted
                      ? 'text-slate-400'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="shrink-0 mt-0.5 text-xs">
                    {isCompleted ? (
                      <i className="fa-solid fa-circle-check text-emerald-500"></i>
                    ) : isInProgress ? (
                      isRunning ? (
                        <i className="fa-solid fa-circle-notch fa-spin text-blue-600"></i>
                      ) : (
                        <i className="fa-regular fa-circle-pause text-amber-600"></i>
                      )
                    ) : (
                      <i className="fa-regular fa-circle text-slate-300"></i>
                    )}
                  </span>
                  <span
                    className={`flex-1 break-words ${
                      isCompleted ? 'line-through text-slate-400' : isInProgress ? 'font-medium text-slate-900' : ''
                    }`}
                  >
                    {todo.content}
                  </span>
                  {isInProgress && (
                    <span
                      className={`shrink-0 ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-1 ${
                        isRunning
                          ? 'text-blue-600 bg-blue-100/70'
                          : 'text-amber-700 bg-amber-100/70 border border-amber-200/50'
                      }`}
                    >
                      {isRunning ? (
                        '进行中'
                      ) : (
                        <>
                          <i className="fa-solid fa-pause text-[8px]"></i>
                          <span>已挂起</span>
                        </>
                      )}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default TodoList

