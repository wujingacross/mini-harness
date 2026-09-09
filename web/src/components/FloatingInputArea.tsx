import React, { useState, useEffect } from 'react'
import { useSession, STORAGE_KEY_SELECTED_MODEL, STORAGE_KEY_CUSTOM_MODELS } from '../context/SessionContext'

const DEFAULT_MODELS = [
  'deepseek-chat',
  'deepseek-reasoner',
  'glm-4-flash',
  'qwen-plus',
]

export const FloatingInputArea: React.FC = () => {
  const { sendPrompt, cancel, steer, isRunning, telemetry, selectedModel, setSelectedModel } = useSession()
  const [text, setText] = useState('')
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>(() => {
    const list = [...DEFAULT_MODELS]
    if (typeof window !== 'undefined') {
      try {
        const savedCustom = localStorage.getItem(STORAGE_KEY_CUSTOM_MODELS)
        if (savedCustom) {
          const parsed = JSON.parse(savedCustom)
          if (Array.isArray(parsed)) {
            for (const m of parsed) {
              if (typeof m === 'string' && m.trim() && !list.includes(m.trim())) {
                list.unshift(m.trim())
              }
            }
          }
        }
        const savedSelected = localStorage.getItem(STORAGE_KEY_SELECTED_MODEL)
        if (savedSelected && savedSelected.trim() && !list.includes(savedSelected.trim())) {
          list.unshift(savedSelected.trim())
        }
      } catch {
        // ignore parse error
      }
    }
    return Array.from(new Set(list))
  })

  useEffect(() => {
    fetch('/api/models')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data?.models) && data.models.length > 0) {
          setAvailableModels((prev) => Array.from(new Set([...prev, ...data.models])))
        }
        if (typeof window !== 'undefined' && !localStorage.getItem(STORAGE_KEY_SELECTED_MODEL)) {
          if (data?.defaultModel) {
            setSelectedModel(data.defaultModel)
          }
        }
      })
      .catch(() => {})
  }, [setSelectedModel])

  const handleSubmit = () => {
    const trimmed = text.trim()
    if (!trimmed || isRunning) return
    setText('')
    sendPrompt(trimmed, selectedModel)
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

  const handleSelectModel = (m: string) => {
    setSelectedModel(m)
    setShowModelDropdown(false)
  }

  const handleAddCustomModel = () => {
    const custom = window.prompt('输入自定义模型标识 (如 glm-4-flash, qwen-plus, gpt-4o 等):')
    if (custom?.trim()) {
      const modelName = custom.trim()
      setAvailableModels((prev) => [modelName, ...prev.filter((m) => m !== modelName)])
      setSelectedModel(modelName)
      setShowModelDropdown(false)
      if (typeof window !== 'undefined') {
        try {
          const raw = localStorage.getItem(STORAGE_KEY_CUSTOM_MODELS)
          const list: string[] = raw ? JSON.parse(raw) : []
          const nextList = [modelName, ...(Array.isArray(list) ? list.filter((m) => m !== modelName) : [])]
          localStorage.setItem(STORAGE_KEY_CUSTOM_MODELS, JSON.stringify(nextList))
        } catch {
          localStorage.setItem(STORAGE_KEY_CUSTOM_MODELS, JSON.stringify([modelName]))
        }
      }
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
              className="px-2 py-1 rounded-md hover:bg-slate-100 text-slate-600 flex items-center gap-1 cursor-pointer text-[11px] font-medium border border-slate-200"
            >
              <span>{selectedModel}</span>
              <i className="fa-solid fa-chevron-down text-[8px] text-slate-400"></i>
            </div>

            {/* Model Dropdown Popup */}
            {showModelDropdown && (
              <div className="absolute right-20 bottom-8 w-48 bg-white border border-slate-200 rounded-lg shadow-xl py-1 z-30 text-xs max-h-64 overflow-y-auto">
                <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                  选择模型 / 供应商
                </div>
                {availableModels.map((m) => {
                  let badge = 'LLM'
                  let badgeColor = 'bg-slate-100 text-slate-600'
                  if (m.includes('deepseek')) {
                    badge = 'DeepSeek'
                    badgeColor = 'bg-blue-50 text-blue-600 border border-blue-100'
                  } else if (m.includes('glm')) {
                    badge = '智谱GLM'
                    badgeColor = 'bg-purple-50 text-purple-600 border border-purple-100'
                  } else if (m.includes('qwen')) {
                    badge = '通义千问'
                    badgeColor = 'bg-amber-50 text-amber-700 border border-amber-100'
                  } else if (m.includes('gpt') || m.includes('o1')) {
                    badge = 'OpenAI'
                    badgeColor = 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                  } else if (m.includes('ollama') || m.includes('llama') || m.includes('mistral')) {
                    badge = '本地/Ollama'
                    badgeColor = 'bg-orange-50 text-orange-700 border border-orange-100'
                  } else if (m.includes('claude')) {
                    badge = 'Anthropic'
                    badgeColor = 'bg-rose-50 text-rose-700 border border-rose-100'
                  }

                  return (
                    <div
                      key={m}
                      onClick={() => handleSelectModel(m)}
                      className={`px-3 py-1.5 hover:bg-slate-100 cursor-pointer text-[11px] flex items-center justify-between transition ${
                        selectedModel === m ? 'text-blue-600 font-semibold bg-blue-50/50' : 'text-slate-700'
                      }`}
                    >
                      <div className="flex flex-col">
                        <span className="font-mono text-xs truncate max-w-[110px]">{m}</span>
                        <span className={`text-[9px] px-1 py-0.2 rounded w-max mt-0.5 ${badgeColor}`}>{badge}</span>
                      </div>
                      {selectedModel === m && <i className="fa-solid fa-check text-[10px] text-blue-600"></i>}
                    </div>
                  )
                })}
                <div
                  onClick={handleAddCustomModel}
                  className="px-3 py-1.5 hover:bg-slate-100 cursor-pointer text-slate-600 text-[11px] font-medium border-t border-slate-100 flex items-center gap-1.5 text-blue-600"
                >
                  <i className="fa-solid fa-plus text-[10px]"></i>
                  <span>输入自定义模型...</span>
                </div>
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
      <div className="text-center text-[10px] text-slate-400 pt-2 font-mono select-none tracking-tight flex items-center justify-center gap-1.5 flex-wrap">
        <span>{telemetry.turns} 轮 · {telemetry.steps} 步</span>
        <span className="text-slate-300">|</span>
        <span>工具调用 {telemetry.toolCalls} 次</span>
        <span className="text-slate-300">|</span>
        <span>输入 {telemetry.inputTokens.toLocaleString()} · 输出 {telemetry.outputTokens.toLocaleString()} tokens</span>
        <span className="text-slate-300">|</span>
        <span>首 token &lt; 1s</span>
      </div>
    </div>
  )
}
