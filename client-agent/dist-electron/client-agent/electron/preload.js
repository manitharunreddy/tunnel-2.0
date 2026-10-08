"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    onUpdateState: (callback) => electron_1.ipcRenderer.on('update-state', (_event, value) => callback(value)),
    onLog: (callback) => electron_1.ipcRenderer.on('log', (_event, value) => callback(value)),
});
