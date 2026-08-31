/**
 * DeepSeek R1 深度推理与思考折叠卡片组件 (Thought Card)
 */
export function createThoughtCard(initialText = '') {
  const container = document.createElement('div');
  container.className = 'border border-slate-800 bg-slate-900/60 rounded-xl overflow-hidden text-xs my-2 transition shadow-sm';

  container.innerHTML = `
    <button class="w-full px-3.5 py-2.5 bg-slate-800/40 hover:bg-slate-800/80 flex items-center justify-between text-slate-300 font-medium transition cursor-pointer select-none">
      <span class="flex items-center gap-2">
        <i class="fa-solid fa-brain text-blue-400 text-xs"></i>
        <span>DeepSeek 深度思考过程</span>
        <span class="text-[10px] text-slate-500 font-mono char-count"></span>
      </span>
      <i class="fa-solid fa-chevron-down text-[10px] text-slate-400 transform transition-transform duration-200"></i>
    </button>
    <div class="content-body p-3.5 text-slate-400 font-mono text-[11px] leading-relaxed whitespace-pre-wrap border-t border-slate-800/80 bg-slate-950/60 max-h-72 overflow-y-auto"></div>
  `;

  const button = container.querySelector('button');
  const body = container.querySelector('.content-body');
  const chevron = container.querySelector('.fa-chevron-down');
  const countEl = container.querySelector('.char-count');

  button.onclick = () => {
    const isHidden = body.classList.toggle('hidden');
    chevron.style.transform = isHidden ? 'rotate(-90deg)' : 'rotate(0deg)';
  };

  let fullText = initialText;
  if (initialText) {
    body.textContent = initialText;
    countEl.textContent = `(${initialText.length} 字)`;
  }

  return {
    element: container,
    appendChunk(chunkText) {
      fullText += chunkText;
      body.textContent = fullText;
      countEl.textContent = `(${fullText.length} 字)`;
      body.scrollTop = body.scrollHeight;
    },
    getText() {
      return fullText;
    },
  };
}
