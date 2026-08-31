/**
 * DeepSeek 官方规范工具调用卡片组件 (Tool Card View)
 * 专为 view_file, replace_file_content, bash, write_to_file, search 等定制视图
 */
export function createToolCard(callId, name, args = {}) {
  const container = document.createElement('div');
  container.className = 'border border-slate-800 bg-slate-900/90 rounded-xl p-3.5 text-xs space-y-2.5 my-2 shadow-sm';
  container.dataset.callId = callId;

  let icon = 'fa-terminal';
  if (name === 'view_file') icon = 'fa-file-lines';
  else if (name === 'replace_file_content') icon = 'fa-code-compare';
  else if (name === 'write_to_file') icon = 'fa-file-circle-plus';
  else if (name === 'find_by_name' || name === 'grep_search') icon = 'fa-magnifying-glass';

  const targetHint = args.path || args.query || args.pattern || (args.command ? args.command.slice(0, 40) : '');

  container.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-2 truncate">
        <span class="w-6 h-6 rounded-md bg-slate-800 flex items-center justify-center text-blue-400 shrink-0">
          <i class="fa-solid ${icon} text-xs"></i>
        </span>
        <span class="font-mono font-semibold text-slate-200">${name}</span>
        ${targetHint ? `<span class="text-[11px] text-slate-400 font-mono truncate max-w-sm">(${JSON.stringify(targetHint)})</span>` : ''}
      </div>
      <div class="status-badge px-2.5 py-0.5 rounded-full text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1.5 shrink-0">
        <i class="fa-solid fa-spinner fa-spin text-[9px]"></i>
        <span>执行中</span>
      </div>
    </div>
    <div class="tool-content font-mono text-[11px] bg-slate-950 p-3 rounded-lg border border-slate-800/80 text-slate-400 max-h-60 overflow-y-auto whitespace-pre-wrap leading-relaxed">等待工具返回执行结果...</div>
  `;

  const badgeEl = container.querySelector('.status-badge');
  const contentEl = container.querySelector('.tool-content');

  return {
    element: container,
    callId,
    setResult(content, isError = false) {
      if (isError) {
        badgeEl.className = 'status-badge px-2.5 py-0.5 rounded-full text-[10px] bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-1.5 shrink-0';
        badgeEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> <span>执行失败</span>';
      } else {
        badgeEl.className = 'status-badge px-2.5 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5 shrink-0';
        badgeEl.innerHTML = '<i class="fa-solid fa-check"></i> <span>执行完成</span>';
      }

      const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);

      // Check for Diff preview
      if (text && text.includes('--- Diff Preview ---')) {
        const lines = text.split('\n');
        contentEl.innerHTML = lines.map((l) => {
          if (l.startsWith('- ')) return `<div class="diff-line-del">${escapeHtml(l)}</div>`;
          if (l.startsWith('+ ')) return `<div class="diff-line-add">${escapeHtml(l)}</div>`;
          return `<div class="diff-line-normal">${escapeHtml(l)}</div>`;
        }).join('');
      } else {
        contentEl.textContent = text || '(无返回值)';
      }
    },
  };
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
