import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react'

export interface SessionHeader {
  id: string
  title?: string
  createdAt?: number
  eventsCount: number
}

export interface SessionEvent {
  type: string
  data: any
}

export interface TelemetryStats {
  turns: number
  steps: number
  toolCalls: number
  inputTokens: number
  outputTokens: number
}

export const STORAGE_KEY_SELECTED_MODEL = 'mini_harness_selected_model'
export const STORAGE_KEY_CUSTOM_MODELS = 'mini_harness_custom_models'

interface SessionContextType {
  sessions: SessionHeader[]
  currentSessionId: string | null
  events: SessionEvent[]
  isRunning: boolean
  turnCount: number
  stepCount: number
  telemetry: TelemetryStats
  activeTab: 'chat' | 'trajectory'
  setActiveTab: (tab: 'chat' | 'trajectory') => void
  switchSession: (sessionId: string) => Promise<void>
  createSession: () => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  sendPrompt: (text: string, model?: string) => Promise<void>
  cancel: () => Promise<void>
  steer: (message: string) => Promise<void>
  exportSessionLog: () => void
  selectedModel: string
  setSelectedModel: (model: string) => void
}

const SessionContext = createContext<SessionContextType | null>(null)

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sessions, setSessions] = useState<SessionHeader[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [turnCount, setTurnCount] = useState(0)
  const [stepCount, setStepCount] = useState(0)
  const [activeTab, setActiveTab] = useState<'chat' | 'trajectory'>('chat')
  const [selectedModel, setSelectedModelState] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY_SELECTED_MODEL)
      if (saved && saved.trim()) return saved.trim()
    }
    return 'deepseek-chat'
  })

  const setSelectedModel = useCallback((model: string) => {
    setSelectedModelState(model)
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_SELECTED_MODEL, model)
    }
  }, [])

  const eventSourceRef = useRef<EventSource | null>(null)

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions')
      if (res.ok) {
        const data = await res.json()
        setSessions(data.sessions || [])
        return data.sessions || []
      }
    } catch (err) {
      console.error('Failed to load sessions:', err)
    }
    return []
  }, [])

  const connectSSE = useCallback((sessionId: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    const es = new EventSource(`/api/sessions/${sessionId}/events`)
    eventSourceRef.current = es

    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data)

        if (event.type === 'user/message') {
          // Avoid duplicate user message if already optimistically added
          setEvents((prev) => {
            const hasSame = prev.some((e) => {
              if (e.type !== 'user/message') return false
              const prevText = typeof e.data?.content === 'string'
                ? e.data.content
                : e.data?.content?.[0]?.text
              const newText = typeof event.data?.content === 'string'
                ? event.data.content
                : event.data?.content?.[0]?.text
              return prevText === newText
            })
            return hasSame ? prev : [...prev, event]
          })
          return
        }

        setEvents((prev) => [...prev, event])

        if (event.type === 'turn/start') {
          setIsRunning(true)
          setTurnCount((prev) => prev + 1)
        } else if (event.type === 'step/start') {
          setStepCount((prev) => prev + 1)
        } else if (event.type === 'turn/end') {
          setIsRunning(false)
          loadSessions()
        }
      } catch {
        // ignore comment lines
      }
    }

    es.onerror = () => {
      // EventSource automatically attempts to reconnect
    }
  }, [loadSessions])

  const switchSession = useCallback(async (sessionId: string) => {
    setCurrentSessionId(sessionId)
    setTurnCount(0)
    setStepCount(0)

    try {
      const res = await fetch(`/api/sessions/${sessionId}`)
      if (res.ok) {
        const data = await res.json()
        setEvents(data.events || [])
      }
    } catch (err) {
      console.error('Failed to fetch session events:', err)
    }

    connectSSE(sessionId)
  }, [connectSSE])

  const createSession = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        const newHeader: SessionHeader = {
          id: data.sessionId,
          title: '新会话',
          createdAt: Date.now(),
          eventsCount: 0,
        }
        // Place new session immediately at the top of the sessions list!
        setSessions((prev) => [newHeader, ...prev.filter((s) => s.id !== data.sessionId)])
        await switchSession(data.sessionId)
        loadSessions()
      }
    } catch (err) {
      console.error('Failed to create session:', err)
    }
  }, [loadSessions, switchSession])

  const telemetry = useMemo<TelemetryStats>(() => {
    let turns = 0
    let steps = 0
    let toolCalls = 0
    let inputTokens = 0
    let outputTokens = 0

    for (const evt of events) {
      if (evt.type === 'turn/start') turns++
      else if (evt.type === 'step/start') steps++
      else if (evt.type === 'tool/call') toolCalls++
      else if (evt.type === 'assistant/message' && evt.data?.usage) {
        inputTokens += evt.data.usage.promptTokens || 0
        outputTokens += evt.data.usage.completionTokens || 0
      }
    }

    return {
      turns: Math.max(turns, turnCount),
      steps: Math.max(steps, stepCount),
      toolCalls,
      inputTokens,
      outputTokens,
    }
  }, [events, turnCount, stepCount])

  const deleteSession = useCallback(
    async (sessionId: string) => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' })
        if (!res.ok) {
          console.error(`Failed to delete session ${sessionId}: ${res.status} ${res.statusText}`)
          return
        }
        setSessions((prev) => prev.filter((s) => s.id !== sessionId))
        if (currentSessionId === sessionId) {
          const remaining = sessions.filter((s) => s.id !== sessionId)
          if (remaining.length > 0) {
            await switchSession(remaining[0].id)
          } else {
            await createSession()
          }
        }
      } catch (err) {
        console.error('Failed to delete session:', err)
      }
    },
    [currentSessionId, sessions, switchSession, createSession],
  )

  const sendPrompt = useCallback(
    async (text: string, model?: string) => {
      let targetSessionId = currentSessionId
      if (!targetSessionId) {
        const res = await fetch('/api/sessions', { method: 'POST' })
        const data = await res.json()
        targetSessionId = data.sessionId
        setCurrentSessionId(targetSessionId)
        await loadSessions()
      }

      if (!targetSessionId) return

      // 1. Optimistically append user message so it appears immediately in the main conversation area!
      const userEvent: SessionEvent = {
        type: 'user/message',
        data: { content: [{ type: 'text', text }], source: 'user' },
      }
      setEvents((prev) => [...prev, userEvent])

      // 2. Optimistically update session title in sidebar and header if it was '新会话'
      setSessions((prev) =>
        prev.map((s) =>
          s.id === targetSessionId && (!s.title || s.title === '新会话')
            ? { ...s, title: text.slice(0, 32) }
            : s,
        ),
      )

      // 3. Ensure SSE connection is active without closing/restarting
      if (!eventSourceRef.current) {
        connectSSE(targetSessionId)
      }

      setIsRunning(true)
      const effectiveModel = model || selectedModel
      try {
        await fetch(`/api/sessions/${targetSessionId}/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: text, model: effectiveModel }),
        })
      } catch (err) {
        console.error('Failed to send prompt:', err)
        setIsRunning(false)
      }
    },
    [currentSessionId, connectSSE, loadSessions, selectedModel],
  )

  const cancel = useCallback(async () => {
    if (!currentSessionId) return
    try {
      await fetch(`/api/sessions/${currentSessionId}/cancel`, { method: 'POST' })
    } catch (err) {
      console.error('Failed to cancel:', err)
    }
  }, [currentSessionId])

  const steer = useCallback(async (message: string) => {
    if (!currentSessionId) return
    try {
      await fetch(`/api/sessions/${currentSessionId}/steer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
    } catch (err) {
      console.error('Failed to steer:', err)
    }
  }, [currentSessionId])

  const exportSessionLog = useCallback(() => {
    if (!currentSessionId) return
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `session-${currentSessionId}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [currentSessionId, events])

  useEffect(() => {
    let isMounted = true
    loadSessions().then((list) => {
      if (isMounted) {
        if (list.length > 0) {
          switchSession(list[0].id)
        } else {
          createSession()
        }
      }
    })
    return () => {
      isMounted = false
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [loadSessions, switchSession, createSession])

  return (
    <SessionContext.Provider
      value={{
        sessions,
        currentSessionId,
        events,
        isRunning,
        turnCount,
        stepCount,
        telemetry,
        activeTab,
        setActiveTab,
        switchSession,
        createSession,
        deleteSession,
        sendPrompt,
        cancel,
        steer,
        exportSessionLog,
        selectedModel,
        setSelectedModel,
      }}
    >
      {children}
    </SessionContext.Provider>
  )
}

export const useSession = () => {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}
