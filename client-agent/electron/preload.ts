import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  onUpdateState: (callback: (data: any) => void) => ipcRenderer.on('update-state', (_event, value) => callback(value)),
  onLog: (callback: (message: string) => void) => ipcRenderer.on('log', (_event, value) => callback(value)),
});
