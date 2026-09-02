import React from 'react'
import { useSession } from '../context/SessionContext'

export const Header: React.FC = () => {
  const { currentSessionId, activeTab, setActiveTab, exportSessionLog } = useSession()

  const displayName = currentSessionId
    ? currentSessionId.replace(/^ses_\d+_/, 'Session ')
    : 'New Session'

  return (
    <header className="h-12 border-b border-slate-200 bg-white px-5 flex items-center justify-between shrink-0 z-20 select-none">
      {/* Left: Session Title, Model Badge, Tabs */}
      <div className="flex items-center space-x-3">
        <span className="text-xs font-semibold text-slate-800 truncate max-w-sm">
          {displayName}
        </span>
        <span className="px-2 py-0.5 text-[10px] font-medium text-slate-500 bg-slate-100 rounded-full border border-slate-200 flex items-center gap-1">
          <i className="fa-solid fa-cube text-[9px] text-slate-400"></i>
          <span>standard</span>
        </span>

        {/* Tab Switcher (对话 | 轨迹) */}
        <div className="flex items-center space-x-1 text-xs ml-3">
          <button
            onClick={() => setActiveTab('chat')}
            className={`px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
              activeTab === 'chat'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            对话
          </button>
          <button
            onClick={() => setActiveTab('trajectory')}
            className={`px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
              activeTab === 'trajectory'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            轨迹
          </button>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center space-x-2">
        <button
          onClick={exportSessionLog}
          className="px-2.5 py-1 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition flex items-center gap-1.5 cursor-pointer"
        >
          <span>Session log</span>
          <i className="fa-solid fa-download text-[10px] text-slate-400"></i>
        </button>
      </div>
    </header>
  )
}
