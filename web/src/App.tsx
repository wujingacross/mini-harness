import React, { useState } from 'react'
import { SessionProvider } from './context/SessionContext'
import { Sidebar } from './components/Sidebar'
import { Header } from './components/Header'
import { TrajectoryStream } from './components/TrajectoryStream'
import { FloatingInputArea } from './components/FloatingInputArea'

export const AppContent: React.FC = () => {
  const [isCollapsed, setIsCollapsed] = useState(false)

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white text-slate-900 select-none">
      {/* Integrated Full-Height Left Sidebar */}
      <Sidebar
        isCollapsed={isCollapsed}
        onToggleCollapse={() => setIsCollapsed((prev) => !prev)}
      />

      {/* Main Execution Workspace (Right Area) */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-white">
        <Header />

        <main className="flex-1 flex flex-col overflow-hidden relative">
          <TrajectoryStream />
          <FloatingInputArea />
        </main>
      </div>
    </div>
  )
}

export const App: React.FC = () => {
  return (
    <SessionProvider>
      <AppContent />
    </SessionProvider>
  )
}

export default App
