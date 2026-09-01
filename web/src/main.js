import { state } from './state.js';
import { connection } from './connection.js';
import { createSidebar } from './components/sidebar.js';
import { createChatStream } from './components/chat-stream.js';
import { createInputArea } from './components/input-area.js';

/**
 * DeepSeek Harness Web 前端总装配主入口
 */
async function bootstrap() {
  const sessionTitleEl = document.getElementById('headerSessionTitle');
  const modelBadgeEl = document.getElementById('headerModelBadge');
  const exportSessionBtn = document.getElementById('exportSessionBtn');

  const chatStream = createChatStream();

  let inputArea;

  const sidebar = createSidebar({
    onSelectSession: async (sessionId) => {
      await switchSession(sessionId);
    },
    onNewSession: async () => {
      await createSession();
    },
    onRefreshFiles: async () => {
      await loadSessions();
    },
  });

  // Export Session Log
  exportSessionBtn.onclick = async () => {
    if (!state.currentSessionId) return;
    try {
      const { events } = await connection.request(`/sessions/${state.currentSessionId}`);
      const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `session-${state.currentSessionId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('导出会话失败: ' + err.message);
    }
  };

  inputArea = createInputArea({
    onSend: async (text) => {
      if (!state.currentSessionId) {
        await createSession();
      }
      chatStream.appendUserMessage(text);
      state.setRunning(true);

      try {
        await connection.request(`/sessions/${state.currentSessionId}/prompt`, {
          method: 'POST',
          body: JSON.stringify({ prompt: text }),
        });
      } catch (err) {
        console.error('Failed to send prompt', err);
        state.setRunning(false);
      }
    },
    onCancel: async () => {
      if (!state.currentSessionId) return;
      await connection.request(`/sessions/${state.currentSessionId}/cancel`, { method: 'POST' });
    },
    onSteer: async (message) => {
      if (!state.currentSessionId) return;
      await connection.request(`/sessions/${state.currentSessionId}/steer`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
    },
  });

  // 监听后端下发的 SSE 实时事件流 (精准匹配 StreamChunk 规范与 SessionEvent)
  connection.onEvent((event) => {
    if (event.type === 'turn/start') {
      state.setRunning(true);
    } else if (event.type === 'step/start') {
      inputArea.incrementStep();
      chatStream.stepStart();
    } else if (event.type === 'assistant/chunk') {
      const chunk = event.data.chunk;
      if (chunk.type === 'reasoning-delta' || chunk.kind === 'reasoning') {
        chatStream.appendThoughtChunk(chunk.text);
      } else if (chunk.type === 'text-delta' || chunk.kind === 'text') {
        chatStream.appendTextChunk(chunk.text);
      } else if (chunk.type === 'tool-call-delta') {
        if (chunk.id && chunk.name) {
          chatStream.handleToolCall(chunk.id, chunk.name, {});
        }
      }
    } else if (event.type === 'tool/call') {
      chatStream.handleToolCall(event.data.callId || event.data.id, event.data.name, event.data.arguments);
    } else if (event.type === 'tool/result') {
      chatStream.handleToolResult(event.data.callId, event.data.content, event.data.isError);
    } else if (event.type === 'turn/end') {
      chatStream.endTurn();
      state.setRunning(false);
      loadSessions();
    }
  });

  async function loadSessions() {
    try {
      const { sessions } = await connection.request('/sessions');
      state.setSessions(sessions);
    } catch (err) {
      console.error('Failed to load sessions', err);
    }
  }

  async function createSession() {
    const { sessionId } = await connection.request('/sessions', { method: 'POST' });
    await loadSessions();
    await switchSession(sessionId);
  }

  async function switchSession(sessionId) {
    if (state.currentSessionId === sessionId) return;
    state.setCurrentSession(sessionId);
    sessionTitleEl.textContent = sessionId.replace(/^ses_\d+_/, 'Session ');

    inputArea.resetStats();

    // 1. 加载历史事件并回放
    const { events } = await connection.request(`/sessions/${sessionId}`);
    chatStream.renderHistory(events);

    // 2. 建立 SSE 订阅长连接
    connection.connectSession(sessionId);
  }

  // 初始化加载数据
  await loadSessions();

  if (state.sessions.length > 0) {
    await switchSession(state.sessions[0].id);
  } else {
    await createSession();
  }
}

window.addEventListener('DOMContentLoaded', bootstrap);
