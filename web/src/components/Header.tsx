import React, { useState } from 'react'
import { useSession } from '../context/SessionContext'

export const Header: React.FC = () => {
  const { currentSessionId, sessions, activeTab, setActiveTab, exportSessionLog } = useSession()
  const [showPresetDropdown, setShowPresetDropdown] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState('standard')

  const currentSession = sessions.find((s) => s.id === currentSessionId)
  const displayName = currentSession?.title || (currentSessionId ? currentSessionId.replace(/^ses_\d+_/, 'Session ') : '新会话')

  return (
    <header className="h-14 border-b border-slate-200 bg-white px-5 flex items-center justify-between shrink-0 z-20 select-none">
      {/* Left Column: Row 1 (Title + Preset Pill) & Row 2 (Tabs) */}
      <div className="flex flex-col justify-center h-full">
        {/* Row 1: Title + Model Preset Pill (Red Box 2) */}
        <div className="flex items-center space-x-2.5 relative">
          <span className="text-[13px] font-semibold text-slate-900 truncate max-w-sm">
            {displayName}
          </span>

          <button
            onClick={() => setShowPresetDropdown((prev) => !prev)}
            className="px-2 py-0.5 text-[11px] font-medium text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-md flex items-center gap-1.5 cursor-pointer shadow-2xs transition"
            title="切换预设模式"
          >
            <span className="text-slate-400 text-[10px]">⬡</span>
            <span>{selectedPreset}</span>
          </button>

          {/* Preset Dropdown */}
          {showPresetDropdown && (
            <div className="absolute left-32 top-7 w-32 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-30 text-xs">
              {['standard', 'code', 'research', 'minimal'].map((p) => (
                <div
                  key={p}
                  onClick={() => {
                    setSelectedPreset(p)
                    setShowPresetDropdown(false)
                  }}
                  className="px-3 py-1.5 hover:bg-slate-100 cursor-pointer text-slate-700 font-mono text-[11px] flex items-center gap-1.5"
                >
                  <span className="text-slate-400 text-[9px]">⬡</span>
                  <span>{p}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Row 2: Tabs (对话 | 轨迹) */}
        <div className="flex items-center space-x-4 text-xs mt-1">
          <button
            onClick={() => setActiveTab('chat')}
            className={`text-xs pb-0.5 transition cursor-pointer ${
              activeTab === 'chat'
                ? 'text-blue-600 border-b-2 border-blue-600 font-semibold'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            对话
          </button>
          <button
            onClick={() => setActiveTab('trajectory')}
            className={`text-xs pb-0.5 transition cursor-pointer ${
              activeTab === 'trajectory'
                ? 'text-blue-600 border-b-2 border-blue-600 font-semibold'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            轨迹
          </button>
        </div>
      </div>

      {/* Right Column: Actions */}
      <div className="flex items-center space-x-2">
        <button
          onClick={exportSessionLog}
          className="px-2.5 py-1 text-xs font-medium text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-md transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
        >
          <span>Session log</span>
          <i className="fa-solid fa-download text-[10px] text-slate-400"></i>
        </button>
      </div>
    </header>
  )
}
