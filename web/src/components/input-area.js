import { state } from '../state.js';

/**
 * DeepSeek Harness 官方悬浮输入卡片与遥测状态栏组件 (Floating Input Card)
 */
export function createInputArea({ onSend, onCancel, onSteer }) {
  const mount = document.getElementById('inputAreaMount');

  mount.innerHTML = `
    <!-- Floating Input Card -->
    <div class="floating-input-card p-3 flex flex-col space-y-2 bg-white">
      <textarea id="promptInput" rows="2" placeholder="给智能体发送消息" 
        class="w-full bg-transparent px-2 py-1 text-sm text-slate-800 placeholder-slate-400 resize-none focus:outline-none leading-relaxed"></textarea>

      <!-- Bottom Control Row -->
      <div class="flex items-center justify-between pt-1 border-t border-slate-100/80 text-xs">
        <!-- Left Controls -->
        <div class="flex items-center space-x-2">
          <button class="w-6 h-6 rounded-md hover:bg-slate-100 text-slate-500 flex items-center justify-center transition cursor-pointer" title="添加上下文">
            <i class="fa-solid fa-plus text-xs"></i>
          </button>
          <div class="px-2 py-1 rounded-md hover:bg-slate-100 text-slate-600 flex items-center gap-1.5 cursor-pointer text-[11px] font-medium border border-slate-200">
            <i class="fa-regular fa-folder text-[10px] text-slate-400"></i>
            <span>Workspace Write</span>
            <i class="fa-solid fa-chevron-down text-[8px] text-slate-400"></i>
          </div>
        </div>

        <!-- Right Controls (Model, Steer, Send) -->
        <div class="flex items-center space-x-2.5">
          <div class="px-2 py-1 rounded-md hover:bg-slate-100 text-slate-600 flex items-center gap-1 cursor-pointer text-[11px] font-medium">
            <span id="modelSelectorText">选择模型</span>
            <i class="fa-solid fa-chevron-down text-[8px] text-slate-400"></i>
          </div>

          <button id="steerBtn" class="w-7 h-7 rounded-full hover:bg-slate-100 text-slate-500 flex items-center justify-center transition cursor-pointer" title="中途纠偏 (Steering)">
            <i class="fa-solid fa-rotate text-xs"></i>
          </button>

          <button id="cancelBtn" class="hidden px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded-md border border-red-200 transition text-[11px] font-medium cursor-pointer">
            停止
          </button>

          <button id="sendBtn" class="w-7 h-7 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center transition shadow-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
            <i class="fa-solid fa-arrow-up text-xs"></i>
          </button>
        </div>
      </div>
    </div>

    <!-- Telemetry Runtime Stats Footer (Exact DeepSeek Harness format) -->
    <div id="telemetryBar" class="text-center text-[10px] text-slate-400 pt-2 font-mono select-none tracking-tight">
      <span id="telemetryTurns">0 轮 · 0 步</span>
      <span class="mx-1 text-slate-300">|</span>
      <span>LLM 实时调度</span>
      <span class="mx-1 text-slate-300">|</span>
      <span>首 token &lt; 1s</span>
      <span class="mx-1 text-slate-300">|</span>
      <span>上下文缓存活跃</span>
    </div>
  `;

  const promptInput = mount.querySelector('#promptInput');
  const sendBtn = mount.querySelector('#sendBtn');
  const cancelBtn = mount.querySelector('#cancelBtn');
  const steerBtn = mount.querySelector('#steerBtn');
  const turnsStatsEl = mount.querySelector('#telemetryTurns');

  let turnCount = 0;
  let stepCount = 0;

  function submit() {
    const text = promptInput.value.trim();
    if (!text || state.isRunning) return;
    promptInput.value = '';
    turnCount++;
    updateTelemetry();
    onSend(text);
  }

  function updateTelemetry() {
    turnsStatsEl.textContent = `${turnCount} 轮 · ${stepCount} 步`;
  }

  promptInput.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  sendBtn.onclick = submit;
  cancelBtn.onclick = onCancel;
  steerBtn.onclick = () => {
    const message = window.prompt('输入中途纠偏指令 (Steering):');
    if (message?.trim()) {
      onSteer(message.trim());
    }
  };

  state.subscribe((_, key) => {
    if (key === 'running') {
      if (state.isRunning) {
        cancelBtn.classList.remove('hidden');
        sendBtn.disabled = true;
      } else {
        cancelBtn.classList.add('hidden');
        sendBtn.disabled = false;
      }
    }
  });

  return {
    setInputText(text) {
      promptInput.value = text;
      promptInput.focus();
    },
    incrementStep() {
      stepCount++;
      updateTelemetry();
    },
    resetStats() {
      turnCount = 0;
      stepCount = 0;
      updateTelemetry();
    },
  };
}
