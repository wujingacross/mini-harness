import React, { useState } from 'react'
import { useSession } from '../context/SessionContext'

export const FloatingInputArea: React.FC = () => {
  const { sendPrompt, cancel, steer, isRunning, turnCount, stepCount } = useSession()
  const [text, setText] = useState('')
  const [selectedModel, setSelectedModel] = useState('选择模型')
  const [showModelDropdown, setShowModelDropdown] = useState(false)

  const handleSubmit = () => {
    const trimmed = text.trim()
    if (!trimmed || isRunning) return
    setText('')
    sendPrompt(trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleSteerClick = () => {
    const msg = window.prompt('输入中途纠偏指令 (Steering):')
    if (msg?.trim()) {
      steer(msg.trim())
    }
  }

  return (
    <div className="shrink-0 p-4 max-w-3xl w-full mx-auto select-none">
      {/* Floating Input Card */}
      <div className="floating-input-card p-3 flex flex-col space-y-2 bg-white">
        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="给智能体发送消息"
          className="w-full bg-transparent px-2 py-1 text-sm text-slate-800 placeholder-slate-400 resize-none focus:outline-none leading-relaxed select-text"
        />

        {/* Bottom Control Row */}
        <div className="flex items-center justify-between pt-1 border-t border-slate-100/80 text-xs">
          {/* Left Controls */}
          <div className="flex items-center space-x-2">
            <button
              className="w-6 h-6 rounded-md hover:bg-slate-100 text-slate-500 flex items-center justify-center transition cursor-pointer"
              title="添加上下文"
            >
              <i className="fa-solid fa-plus text-xs"></i>
            </button>
            <div className="px-2 py-1 rounded-md hover:bg-slate-100 text-slate-600 flex items-center gap-1.5 cursor-pointer text-[11px] font-medium border border-slate-200">
              <i className="fa-regular fa-folder text-[10px] text-slate-400"></i>
              <span>Workspace Write</span>
              <i className="fa-solid fa-chevron-down text-[8px] text-slate-400"></i>
            </div>
          </div>

          {/* Right Controls */}
          <div className="flex items-center space-x-2.5 relative">
            <div
              onClick={() => setShowModelDropdown((prev) => !prev)}
              className="px-2 py-1 rounded-md hover:bg-slate-100 text-slate-600 flex items-center gap-1 cursor-pointer text-[11px] font-medium"
            >
              <span>{selectedModel}</span>
              <i className="fa-solid fa-chevron-down text-[8px] text-slate-400"></i>
            </div>

            {/* Model Dropdown Popup */}
            {showModelDropdown && (
              <div className="absolute right-20 bottom-8 w-36 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-30 text-xs">
                {['deepseek-chat', 'deepseek-reasoner'].map((m) => (
                  <div
                    key={m}
                    onClick={() => {
                      setSelectedModel(m)
                      setShowModelDropdown(false)
                    }}
                    className="px-3 py-1.5 hover:bg-slate-100 cursor-pointer text-slate-700 font-mono text-[11px]"
                  >
                    {m}
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={handleSteerClick}
              className="w-7 h-7 rounded-full hover:bg-slate-100 text-slate-500 flex items-center justify-center transition cursor-pointer"
              title="中途纠偏 (Steering)"
            >
              <i className="fa-solid fa-rotate text-xs"></i>
            </button>

            {isRunning && (
              <button
                onClick={cancel}
                className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded-md border border-red-200 transition text-[11px] font-medium cursor-pointer"
              >
                停止
              </button>
            )}

            <button
              onClick={handleSubmit}
              disabled={!text.trim() || isRunning}
              className="w-7 h-7 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center transition shadow-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <i className="fa-solid fa-arrow-up text-xs"></i>
            </button>
          </div>
        </div>
      </div>

      {/* Telemetry Runtime Stats Footer */}
      <div className="text-center text-[10px] text-slate-400 pt-2 font-mono select-none tracking-tight">
        <span>{turnCount} 轮 · {stepCount} 步</span>
        <span className="mx-1 text-slate-300">|</span>
        <span>LLM 实时调度</span>
        <span className="mx-1 text-slate-300">|</span>
        <span>首 token &lt; 1s</span>
        <span className="mx-1 text-slate-300">|</span>
        <span>上下文缓存活跃</span>
      </div>
    </div>
  )
}
