import React, { useState } from 'react'
import { useSession, TodoItem } from '../context/SessionContext'

export const TodoList: React.FC = () => {
  const { todos, planState, togglePlanMode } = useSession()
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
    <div
      style={{
        margin: '12px 16px',
        padding: '12px 14px',
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 8,
        backdropFilter: 'blur(8px)',
        fontSize: '13px',
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '15px' }}>📋</span>
          <span style={{ fontWeight: 600, color: '#e2e8f0' }}>任务规划与执行清单</span>
          {planState.active && (
            <span
              style={{
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: 4,
                background: 'rgba(234, 179, 8, 0.15)',
                color: '#eab308',
                border: '1px solid rgba(234, 179, 8, 0.3)',
                fontWeight: 600,
              }}
            >
              PLAN MODE
            </span>
          )}
          {totalCount > 0 && (
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>
              ({completedCount}/{totalCount} 完成 · {progressPercent}%)
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {planState.active && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                togglePlanMode(false)
              }}
              style={{
                padding: '3px 8px',
                fontSize: '11px',
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#ef4444',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              退出规划模式 (/plan off)
            </button>
          )}
          <span style={{ color: '#64748b', fontSize: '12px' }}>{collapsed ? '展开 ▼' : '收起 ▲'}</span>
        </div>
      </div>

      {/* Progress Bar */}
      {totalCount > 0 && !collapsed && (
        <div
          style={{
            marginTop: 10,
            marginBottom: 10,
            height: 4,
            background: 'rgba(255, 255, 255, 0.08)',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progressPercent}%`,
              background: progressPercent === 100 ? '#10b981' : '#3b82f6',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      )}

      {/* Task List */}
      {!collapsed && totalCount > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
          {todos.map((todo, idx) => {
            const isCompleted = todo.status === 'completed'
            const isInProgress = todo.status === 'in_progress'

            return (
              <div
                key={todo.id || idx}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '4px 6px',
                  borderRadius: 4,
                  background: isInProgress ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                  border: isInProgress ? '1px solid rgba(59, 130, 246, 0.2)' : '1px solid transparent',
                }}
              >
                <span style={{ fontSize: '14px', lineHeight: '18px', userSelect: 'none' }}>
                  {isCompleted ? '✅' : isInProgress ? '⏳' : '⚪'}
                </span>
                <span
                  style={{
                    color: isCompleted ? '#64748b' : isInProgress ? '#60a5fa' : '#cbd5e1',
                    textDecoration: isCompleted ? 'line-through' : 'none',
                    fontWeight: isInProgress ? 500 : 400,
                    lineHeight: '18px',
                    wordBreak: 'break-word',
                  }}
                >
                  {todo.content}
                </span>
                {isInProgress && (
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: '11px',
                      color: '#3b82f6',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    进行中...
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default TodoList
