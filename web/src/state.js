/**
 * Mini-Harness Web 前端核心响应式状态管理 (State Store)
 */
class AppState {
  constructor() {
    this.currentSessionId = null;
    this.sessions = [];
    this.workspaceFiles = [];
    this.isRunning = false;
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(changeKey) {
    for (const listener of this.listeners) {
      listener(this, changeKey);
    }
  }

  setSessions(sessions) {
    this.sessions = sessions;
    this.notify('sessions');
  }

  setWorkspaceFiles(files) {
    this.workspaceFiles = files;
    this.notify('files');
  }

  setCurrentSession(id) {
    this.currentSessionId = id;
    this.notify('currentSession');
  }

  setRunning(running) {
    this.isRunning = running;
    this.notify('running');
  }
}

export const state = new AppState();
