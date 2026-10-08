export {};

declare global {

  interface Window {
    electronAPI: {
      onUpdateState: (callback: (data: any) => void) => void;
      onLog: (callback: (message: string) => void) => void;
    };
  }
}

const ui = {
  statusBadge: document.getElementById('status-badge') as HTMLElement,
  agentId: document.getElementById('agent-id') as HTMLElement,
  cloudUrl: document.getElementById('cloud-url') as HTMLElement,
  lastHeartbeat: document.getElementById('last-heartbeat') as HTMLElement,
  reconnectAttempts: document.getElementById('reconnect-attempts') as HTMLElement,
  activeTunnels: document.getElementById('active-tunnels') as HTMLElement,
  logsContainer: document.getElementById('logs-container') as HTMLElement,
};

function addLog(message: string) {
  const div = document.createElement('div');
  div.className = 'log-entry';
  div.textContent = message;
  ui.logsContainer.appendChild(div);
  
  // Auto-scroll
  ui.logsContainer.scrollTop = ui.logsContainer.scrollHeight;
}

window.electronAPI.onUpdateState((data) => {
  if (data.status) {
    ui.statusBadge.textContent = data.status;
    ui.statusBadge.className = 'badge'; // reset
    if (data.status === 'Connected') {
      ui.statusBadge.classList.add('connected');
    } else if (data.status === 'Reconnecting') {
      ui.statusBadge.classList.add('reconnecting');
    }
  }
  
  if (data.agentId) ui.agentId.textContent = data.agentId;
  if (data.cloudUrl) ui.cloudUrl.textContent = data.cloudUrl;
  
  if (data.lastHeartbeat) {
    const time = new Date(data.lastHeartbeat).toLocaleTimeString();
    ui.lastHeartbeat.textContent = time;
  }
  
  if (data.reconnectAttempts !== undefined) {
    ui.reconnectAttempts.textContent = data.reconnectAttempts.toString();
  }
  
  if (data.activeTunnels !== undefined) {
    ui.activeTunnels.textContent = data.activeTunnels.toString();
  }
});

window.electronAPI.onLog((message) => {
  addLog(message);
});
