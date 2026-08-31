/**
 * DeepSeek Harness 官方执行轨迹流 (Trajectory Stream)
 * 100% 对齐官方轻量时间线设计：Think · Read · Bash · Grep · Assistant Prose
 */
export function createChatStream() {
  const mount = document.getElementById('chatStreamMount');

  let currentAssistantTextEl = null;
  let activeToolElements = new Map();

  function scrollBottom() {
    mount.scrollTop = mount.scrollHeight;
  }

  function clear() {
    mount.innerHTML = '';
    currentAssistantTextEl = null;
    activeToolElements.clear();
  }

  function appendUserMessage(text) {
    const row = document.createElement('div');
    row.className = 'trajectory-row pt-4 pb-2 border-b border-slate-100 font-semibold text-slate-900';
    row.innerHTML = `
      <span class="trajectory-icon text-blue-600"><i class="fa-solid fa-circle-user text-sm"></i></span>
      <span class="trajectory-type text-blue-600 font-bold">User</span>
      <span class="trajectory-sep">·</span>
      <span class="text-slate-900 font-normal leading-relaxed whitespace-pre-wrap">${escapeHtml(text)}</span>
    `;
    mount.appendChild(row);
    scrollBottom();
  }

  function appendThoughtChunk(chunkText) {
    // Look for last think row or create one
    let lastRow = mount.lastElementChild;
    if (!lastRow || !lastRow.classList.contains('trajectory-think-row')) {
      lastRow = document.createElement('div');
      lastRow.className = 'trajectory-row trajectory-think-row';
      lastRow.innerHTML = `
        <span class="trajectory-icon"><i class="fa-solid fa-cube text-[11px]"></i></span>
        <span class="trajectory-type">Think</span>
        <span class="trajectory-sep">·</span>
        <span class="trajectory-content"></span>
      `;
      mount.appendChild(lastRow);
    }
    const contentEl = lastRow.querySelector('.trajectory-content');
    contentEl.textContent += chunkText;
    scrollBottom();
  }

  function appendTextChunk(chunkText) {
    if (!currentAssistantTextEl) {
      currentAssistantTextEl = document.createElement('div');
      currentAssistantTextEl.className = 'prose-assistant py-2 my-1 whitespace-pre-wrap';
      mount.appendChild(currentAssistantTextEl);
    }
    currentAssistantTextEl.textContent += chunkText;
    scrollBottom();
  }

  function handleToolCall(callId, name, args = {}) {
    if (activeToolElements.has(callId)) return;

    currentAssistantTextEl = null;

    let icon = 'fa-terminal';
    let label = 'Tool';
    let paramText = '';

    if (name === 'view_file' || name === 'read_file') {
      icon = 'fa-file-lines';
      label = 'Read';
      paramText = args.path || '';
    } else if (name === 'replace_file_content' || name === 'edit_file') {
      icon = 'fa-pen-to-square';
      label = 'Edit';
      paramText = args.path || '';
    } else if (name === 'write_to_file') {
      icon = 'fa-file-circle-plus';
      label = 'Write';
      paramText = args.path || '';
    } else if (name === 'find_by_name') {
      icon = 'fa-magnifying-glass';
      label = 'Glob';
      paramText = args.pattern || '';
    } else if (name === 'grep_search') {
      icon = 'fa-magnifying-glass';
      label = 'Grep';
      paramText = args.query || '';
    } else if (name === 'bash') {
      icon = 'fa-terminal';
      label = 'Bash';
      paramText = args.command || '';
    }

    const row = document.createElement('div');
    row.className = 'trajectory-row select-none';
    row.dataset.callId = callId;

    row.innerHTML = `
      <span class="trajectory-icon"><i class="fa-solid ${icon} text-[11px]"></i></span>
      <span class="trajectory-type">${label}</span>
      <span class="trajectory-sep">·</span>
      <span class="trajectory-content font-mono text-xs ${paramText.includes('/') ? 'trajectory-path' : ''}">${escapeHtml(paramText || name)}</span>
      <span class="status-indicator ml-auto text-[10px] text-slate-400 font-normal">运行中...</span>
    `;

    mount.appendChild(row);
    activeToolElements.set(callId, row);
    scrollBottom();
  }

  function handleToolResult(callId, content, isError = false) {
    const row = activeToolElements.get(callId);
    if (row) {
      const statusEl = row.querySelector('.status-indicator');
      if (statusEl) {
        statusEl.textContent = isError ? '失败' : '';
        statusEl.className = isError ? 'status-indicator ml-auto text-[10px] text-red-500 font-medium' : '';
      }
    }
    scrollBottom();
  }

  function endTurn() {
    currentAssistantTextEl = null;
  }

  function renderHistory(events) {
    clear();
    for (const event of events) {
      if (event.type === 'user/message') {
        const text = event.data.content?.[0]?.text || '';
        appendUserMessage(text);
      } else if (event.type === 'assistant/message') {
        for (const block of event.data.content || []) {
          if (block.type === 'reasoning') {
            const row = document.createElement('div');
            row.className = 'trajectory-row trajectory-think-row';
            row.innerHTML = `
              <span class="trajectory-icon"><i class="fa-solid fa-cube text-[11px]"></i></span>
              <span class="trajectory-type">Think</span>
              <span class="trajectory-sep">·</span>
              <span class="trajectory-content">${escapeHtml(block.text)}</span>
            `;
            mount.appendChild(row);
          } else if (block.type === 'text') {
            const p = document.createElement('div');
            p.className = 'prose-assistant py-2 my-1 whitespace-pre-wrap';
            p.textContent = block.text;
            mount.appendChild(p);
          } else if (block.type === 'tool-call') {
            handleToolCall(block.id, block.name, block.arguments);
          }
        }
        endTurn();
      } else if (event.type === 'tool/result') {
        handleToolResult(event.data.callId, event.data.content, event.data.isError);
      }
    }
    scrollBottom();
  }

  return {
    clear,
    appendUserMessage,
    appendThoughtChunk,
    appendTextChunk,
    handleToolCall,
    handleToolResult,
    endTurn,
    renderHistory,
  };
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
