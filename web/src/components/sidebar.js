import { state } from '../state.js';

/**
 * DeepSeek Harness 官方左侧与顶部打通一体化侧边栏 (Full-Height Integrated Sidebar)
 */
export function createSidebar({ onSelectSession, onNewSession, onRefreshFiles }) {
  const container = document.getElementById('sidebarMount');

  let isCollapsed = false;

  function render() {
    if (isCollapsed) {
      // Collapsed Slim Mode (Exact DeepSeek Harness collapsed state)
      container.className = 'w-14 border-r border-slate-200 bg-[#f8f9fa] flex flex-col items-center justify-between select-none shrink-0 transition-all duration-200 h-full';
      container.innerHTML = `
        <!-- Top Section (Logo aligned with header) -->
        <div class="flex flex-col items-center w-full">
          <div class="h-12 border-b border-slate-200 flex items-center justify-center w-full">
            <button id="collapsedLogoBtn" class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-900 hover:bg-slate-200/70 transition cursor-pointer" title="展开侧边栏">
              <!-- DeepSeek Whale Logo -->
              <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
              </svg>
            </button>
          </div>

          <!-- Action Icons -->
          <div class="flex flex-col items-center space-y-3.5 pt-4 w-full">
            <button id="collapsedNewBtn" class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-700 hover:text-slate-900 hover:bg-slate-200/70 transition cursor-pointer" title="新会话">
              <i class="fa-regular fa-square-plus text-base"></i>
            </button>
            <button id="collapsedWorkspaceBtn" class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-700 hover:text-slate-900 hover:bg-slate-200/70 transition cursor-pointer" title="工作区">
              <i class="fa-regular fa-folder-open text-sm"></i>
            </button>
            <button id="collapsedSearchBtn" class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-700 hover:text-slate-900 hover:bg-slate-200/70 transition cursor-pointer" title="搜索">
              <i class="fa-solid fa-magnifying-glass text-sm"></i>
            </button>
          </div>
        </div>

        <!-- Bottom Settings Icon -->
        <div class="pb-3 w-full flex justify-center">
          <button id="collapsedSettingsBtn" class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-700 hover:text-slate-900 hover:bg-slate-200/70 transition cursor-pointer" title="设置">
            <i class="fa-solid fa-gear text-sm"></i>
          </button>
        </div>
      `;

      container.querySelector('#collapsedLogoBtn').onclick = () => toggleCollapse();
      container.querySelector('#collapsedNewBtn').onclick = () => onNewSession();
      container.querySelector('#collapsedWorkspaceBtn').onclick = () => toggleCollapse();
      container.querySelector('#collapsedSearchBtn').onclick = () => toggleCollapse();
      return;
    }

    // Expanded Mode (Exact DeepSeek Harness expanded sidebar)
    container.className = 'w-64 border-r border-slate-200 bg-[#f8f9fa] flex flex-col shrink-0 select-none transition-all duration-200 h-full';
    container.innerHTML = `
      <!-- Top Integrated Header (Brand + Collapse Button) -->
      <div class="h-12 border-b border-slate-200 px-4 flex items-center justify-between shrink-0">
        <div class="flex items-center space-x-1.5 font-bold tracking-tight text-slate-900">
          <span class="text-base font-extrabold tracking-tighter">deepseek</span>
          <span class="px-1.5 py-0.5 text-[9px] font-black uppercase bg-black text-white rounded tracking-wider">HARNESS</span>
        </div>
        <button id="expandedCollapseBtn" class="text-slate-400 hover:text-slate-700 p-1 transition cursor-pointer" title="收起侧边栏">
          <i class="fa-solid fa-bars-staggered text-xs"></i>
        </button>
      </div>

      <!-- Top New Session Button -->
      <div class="p-3">
        <button id="sidebarNewSessionBtn" class="w-full py-1.5 px-3 bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-lg text-xs font-semibold text-slate-800 transition flex items-center justify-center gap-1.5 shadow-sm cursor-pointer">
          <i class="fa-solid fa-plus text-[10px] text-slate-500"></i>
          <span>新会话</span>
        </button>
      </div>

      <!-- Workspace Header -->
      <div class="px-3.5 py-1.5 flex items-center justify-between text-xs text-slate-500 font-medium">
        <span class="text-[11px] text-slate-500 font-semibold">工作区</span>
        <div class="flex items-center space-x-2 text-slate-400">
          <button id="sidebarSearchBtn" class="hover:text-slate-700 cursor-pointer p-0.5" title="搜索">
            <i class="fa-solid fa-magnifying-glass text-[11px]"></i>
          </button>
          <button id="sidebarRefreshFilesBtn" class="hover:text-slate-700 cursor-pointer p-0.5" title="刷新工作区">
            <i class="fa-solid fa-rotate-right text-[11px]"></i>
          </button>
          <button class="hover:text-slate-700 cursor-pointer p-0.5" title="打开目录">
            <i class="fa-solid fa-arrow-up-right-from-square text-[11px]"></i>
          </button>
        </div>
      </div>

      <!-- Sessions Tree Under Project Folder -->
      <div class="flex-1 overflow-y-auto px-2 py-1 space-y-1">
        <!-- Project Folder Header -->
        <div class="px-2 py-1 text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <i class="fa-regular fa-folder text-blue-500 text-xs"></i>
          <span id="projectNameLabel">mini-harness</span>
        </div>
        <!-- Session items list -->
        <div id="sessionsContainer" class="pl-4 space-y-0.5"></div>
      </div>

      <!-- Bottom Settings Bar -->
      <div class="p-3 border-t border-slate-200 bg-[#f8f9fa] flex items-center justify-between text-xs text-slate-600">
        <button class="hover:text-slate-900 transition flex items-center gap-2 cursor-pointer">
          <i class="fa-solid fa-gear text-slate-400 text-xs"></i>
          <span>设置</span>
        </button>
      </div>
    `;

    const sessionsContainer = container.querySelector('#sessionsContainer');
    const newBtn = container.querySelector('#sidebarNewSessionBtn');
    const collapseBtn = container.querySelector('#expandedCollapseBtn');
    const refreshBtn = container.querySelector('#sidebarRefreshFilesBtn');

    if (collapseBtn) collapseBtn.onclick = () => toggleCollapse();
    newBtn.onclick = onNewSession;
    if (refreshBtn) refreshBtn.onclick = onRefreshFiles;

    renderSessionItems(sessionsContainer);
  }

  function renderSessionItems(sessionsContainer) {
    if (!sessionsContainer) return;
    sessionsContainer.innerHTML = '';
    state.sessions.forEach((ses) => {
      const isCurrent = ses.id === state.currentSessionId;
      const item = document.createElement('div');
      item.className = `px-2.5 py-1.5 rounded-md text-xs cursor-pointer flex items-center justify-between transition select-none ${
        isCurrent
          ? 'bg-slate-200/80 text-slate-900 font-medium'
          : 'hover:bg-slate-200/50 text-slate-600 hover:text-slate-900'
      }`;

      const displayName = ses.id.replace(/^ses_\d+_/, 'Session ');
      item.innerHTML = `
        <span class="truncate pr-2">${displayName}</span>
        <span class="text-[10px] text-slate-400 shrink-0 font-normal">刚刚</span>
      `;
      item.onclick = () => onSelectSession(ses.id);
      sessionsContainer.appendChild(item);
    });
  }

  function toggleCollapse() {
    isCollapsed = !isCollapsed;
    render();
  }

  state.subscribe((_, key) => {
    if (key === 'sessions' || key === 'currentSession') {
      if (!isCollapsed) {
        const sessionsContainer = container.querySelector('#sessionsContainer');
        renderSessionItems(sessionsContainer);
      }
    }
  });

  render();

  return {
    toggleCollapse,
    setCollapsed(collapsed) {
      isCollapsed = collapsed;
      render();
    },
  };
}
