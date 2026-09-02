import React from 'react'
import { useSession } from '../context/SessionContext'

interface SidebarProps {
  isCollapsed: boolean
  onToggleCollapse: () => void
}

export const Sidebar: React.FC<SidebarProps> = ({ isCollapsed, onToggleCollapse }) => {
  const { sessions, currentSessionId, switchSession, createSession } = useSession()

  if (isCollapsed) {
    return (
      <aside className="w-14 border-r border-slate-200 bg-[#f8f9fa] flex flex-col items-center justify-between select-none shrink-0 transition-all duration-200 h-full">
        {/* Top Logo Section */}
        <div className="flex flex-col items-center w-full">
          <div className="h-14 border-b border-slate-200 flex items-center justify-center w-full">
            <button
              onClick={onToggleCollapse}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-900 hover:bg-slate-200/70 transition cursor-pointer"
              title="展开侧边栏"
            >
              {/* DeepSeek Whale Logo */}
              <div className="w-6 h-6 rounded bg-[#1d4ed8] flex items-center justify-center text-white shrink-0 shadow-xs">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                </svg>
              </div>
            </button>
          </div>

          {/* Action Icons */}
          <div className="flex flex-col items-center space-y-3.5 pt-4 w-full">
            <button
              onClick={() => createSession()}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-700 hover:text-slate-900 hover:bg-slate-200/70 transition cursor-pointer"
              title="新会话"
            >
              <i className="fa-regular fa-square-plus text-base"></i>
            </button>
            <button
              onClick={onToggleCollapse}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-700 hover:text-slate-900 hover:bg-slate-200/70 transition cursor-pointer"
              title="工作区"
            >
              <i className="fa-regular fa-folder-open text-sm"></i>
            </button>
            <button
              onClick={onToggleCollapse}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-700 hover:text-slate-900 hover:bg-slate-200/70 transition cursor-pointer"
              title="搜索"
            >
              <i className="fa-solid fa-magnifying-glass text-sm"></i>
            </button>
          </div>
        </div>

        {/* Bottom Settings Icon */}
        <div className="pb-3 w-full flex justify-center">
          <button
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-700 hover:text-slate-900 hover:bg-slate-200/70 transition cursor-pointer"
            title="设置"
          >
            <i className="fa-solid fa-gear text-sm"></i>
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="w-64 border-r border-slate-200 bg-[#f8f9fa] flex flex-col shrink-0 select-none transition-all duration-200 h-full">
      {/* Top Header: Brand & Collapse Toggle (Red Box 1) */}
      <div className="h-14 border-b border-slate-200 px-3.5 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center space-x-2">
          {/* DeepSeek Logo Icon */}
          <div className="w-5 h-5 rounded bg-[#1d4ed8] flex items-center justify-center text-white shrink-0 shadow-xs">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
            </svg>
          </div>
          <span className="text-[15px] font-extrabold tracking-tight text-slate-900">deepseek</span>
          <span className="px-1.5 py-0.5 text-[9px] font-black uppercase bg-black text-white rounded tracking-wider">
            HARNESS
          </span>
        </div>

        {/* Panel Collapse Icon Button */}
        <button
          onClick={onToggleCollapse}
          className="w-7 h-7 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800 flex items-center justify-center transition cursor-pointer"
          title="收起侧边栏"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M9 3v18" />
          </svg>
        </button>
      </div>

      {/* New Session Button */}
      <div className="p-3">
        <button
          onClick={() => createSession()}
          className="w-full py-1.5 px-3 bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-lg text-xs font-semibold text-slate-800 transition flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
        >
          <i className="fa-solid fa-plus text-[10px] text-slate-500"></i>
          <span>新会话</span>
        </button>
      </div>

      {/* Workspace Header (Red Box 3) */}
      <div className="px-3.5 py-1.5 flex items-center justify-between text-xs text-slate-500 font-medium">
        <span className="text-[11px] text-slate-500 font-semibold">工作区</span>
        <div className="flex items-center space-x-2.5 text-slate-400">
          <button className="hover:text-slate-700 cursor-pointer p-0.5" title="搜索">
            <i className="fa-solid fa-magnifying-glass text-[11px]"></i>
          </button>
          <button className="hover:text-slate-700 cursor-pointer p-0.5" title="过滤 / 调整">
            <i className="fa-solid fa-sliders text-[11px]"></i>
          </button>
          <button className="hover:text-slate-700 cursor-pointer p-0.5" title="打开工作区">
            <i className="fa-solid fa-arrow-up-right-from-square text-[11px]"></i>
          </button>
        </div>
      </div>

      {/* Sessions Tree Under Project Folder */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
        <div className="px-2 py-1 text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <i className="fa-regular fa-folder text-blue-500 text-xs"></i>
          <span>deepseek-harness</span>
        </div>

        <div className="pl-3 space-y-0.5">
          {sessions.map((ses) => {
            const isCurrent = ses.id === currentSessionId
            const displayName = ses.title || ses.id.replace(/^ses_\d+_/, 'Session ')
            return (
              <div
                key={ses.id}
                onClick={() => switchSession(ses.id)}
                className={`px-2.5 py-1.5 rounded-lg text-xs cursor-pointer flex items-center justify-between transition select-none ${
                  isCurrent
                    ? 'bg-slate-100 text-slate-900 font-medium'
                    : 'hover:bg-slate-100/60 text-slate-600 hover:text-slate-900'
                }`}
              >
                <span className="truncate pr-2">{displayName}</span>
                <span className="text-[10px] text-slate-400 shrink-0 font-normal">刚刚</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Bottom Settings Bar */}
      <div className="p-3 border-t border-slate-200 bg-[#f8f9fa] flex items-center justify-between text-xs text-slate-600">
        <button className="hover:text-slate-900 transition flex items-center gap-2 cursor-pointer">
          <i className="fa-solid fa-gear text-slate-400 text-xs"></i>
          <span>设置</span>
        </button>
      </div>
    </aside>
  )
}
