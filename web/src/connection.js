/**
 * Mini-Harness 网络通信服务 (Connection & Downlink)
 * 提供 REST API 与 Server-Sent Events (SSE) 长连接事件订阅
 */
export class ConnectionService {
  constructor() {
    this.eventSource = null;
    this.eventHandlers = new Set();
    this.statusListeners = new Set();
  }

  async request(path, options = {}) {
    const res = await fetch('/api' + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(errBody.error || `HTTP ${res.status}`);
    }
    return await res.json();
  }

  onEvent(handler) {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  onStatusChange(listener) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  privateNotifyStatus(status, text) {
    for (const listener of this.statusListeners) {
      listener(status, text);
    }
  }

  connectSession(sessionId) {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.privateNotifyStatus('connecting', '连接中...');
    this.eventSource = new EventSource(`/api/sessions/${sessionId}/events`);

    this.eventSource.onopen = () => {
      this.privateNotifyStatus('online', '在线连接');
    };

    this.eventSource.onerror = () => {
      this.privateNotifyStatus('error', '重连中...');
    };

    this.eventSource.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        for (const handler of this.eventHandlers) {
          handler(data);
        }
      } catch (err) {
        // ignore heartbeat comment lines
      }
    };
  }

  close() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}

export const connection = new ConnectionService();
