"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const ws_1 = require("ws");
const net = __importStar(require("net"));
const dotenv = __importStar(require("dotenv"));
const protocol_1 = require("../../shared/protocol");
dotenv.config({ path: path.join(__dirname, '../../.env') });
let mainWindow = null;
let ws = null;
let reconnectAttempts = 0;
let isConnected = false;
let heartbeatInterval = null;
const activeTunnels = new Map();
const agentId = process.env.AGENT_ID || 'agent-001';
const agentSecret = process.env.AGENT_SECRET || 'secret-token-123';
const cloudUrl = process.env.CLOUD_URL || 'ws://localhost:3000/tunnel';
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
        },
    });
    if (process.env.NODE_ENV === 'development') {
        mainWindow.loadURL('http://localhost:5173');
    }
    else {
        mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
    }
}
function sendToUI(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
}
function log(message) {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    sendToUI('log', logMessage);
}
function startHeartbeat() {
    if (heartbeatInterval)
        clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        if (ws && ws.readyState === ws_1.WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: protocol_1.MessageType.PING }));
            log('Heartbeat sent');
            sendToUI('update-state', { lastHeartbeat: new Date().toISOString() });
        }
    }, 300000); // 5 minutes
}
function connectToCloud() {
    log(`Connecting to cloud: ${cloudUrl} (Attempt ${reconnectAttempts + 1})`);
    try {
        ws = new ws_1.WebSocket(cloudUrl);
    }
    catch (err) {
        log(`WebSocket creation failed: ${err}`);
        scheduleReconnect();
        return;
    }
    ws.on('open', () => {
        log('Connected to cloud server');
        isConnected = true;
        reconnectAttempts = 0;
        sendToUI('update-state', { status: 'Connected', reconnectAttempts });
        // Authenticate
        if (ws) {
            ws.send(JSON.stringify({
                type: protocol_1.MessageType.REGISTER,
                agentId,
                agentSecret
            }));
        }
        startHeartbeat();
    });
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            switch (msg.type) {
                case protocol_1.MessageType.REGISTER_ACK:
                    if (msg.success) {
                        log('Registered successfully');
                    }
                    else {
                        log(`Registration failed: ${msg.message}`);
                    }
                    break;
                case protocol_1.MessageType.OPEN:
                    log(`Opening local tunnel to ${msg.host}:${msg.port} for ${msg.connectionId}`);
                    createLocalTunnel(msg.connectionId, msg.host, msg.port);
                    break;
                case protocol_1.MessageType.DATA:
                    const socket = activeTunnels.get(msg.connectionId);
                    if (socket) {
                        socket.write(Buffer.from(msg.data, 'base64'));
                    }
                    break;
                case protocol_1.MessageType.CLOSE:
                    const tunnelToClose = activeTunnels.get(msg.connectionId);
                    if (tunnelToClose) {
                        tunnelToClose.end();
                        activeTunnels.delete(msg.connectionId);
                        log(`Tunnel ${msg.connectionId} closed by cloud`);
                        updateTunnelCount();
                    }
                    break;
            }
        }
        catch (e) {
            log(`Error parsing message: ${e}`);
        }
    });
    ws.on('close', () => {
        log('Connection to cloud lost');
        isConnected = false;
        if (heartbeatInterval)
            clearInterval(heartbeatInterval);
        // Cleanup tunnels
        for (const [connId, socket] of activeTunnels.entries()) {
            socket.destroy();
        }
        activeTunnels.clear();
        updateTunnelCount();
        scheduleReconnect();
    });
    ws.on('error', (err) => {
        log(`WebSocket error: ${err.message}`);
    });
}
function scheduleReconnect() {
    if (isConnected)
        return;
    let delay = Math.pow(2, reconnectAttempts) * 1000;
    if (delay > 30000)
        delay = 30000; // max 30s backoff
    if (reconnectAttempts === 0)
        delay = 1000;
    if (reconnectAttempts === 1)
        delay = 2000;
    if (reconnectAttempts === 2)
        delay = 5000;
    if (reconnectAttempts === 3)
        delay = 10000;
    log(`Reconnecting in ${delay / 1000}s...`);
    sendToUI('update-state', { status: 'Reconnecting', reconnectAttempts });
    reconnectAttempts++;
    setTimeout(connectToCloud, delay);
}
function createLocalTunnel(connectionId, host, port) {
    const socket = new net.Socket();
    socket.connect(port, host, () => {
        log(`Local tunnel established for ${connectionId}`);
        activeTunnels.set(connectionId, socket);
        updateTunnelCount();
        if (ws && ws.readyState === ws_1.WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: protocol_1.MessageType.OPEN_ACK,
                connectionId,
                success: true
            }));
        }
    });
    socket.on('data', (data) => {
        if (ws && ws.readyState === ws_1.WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: protocol_1.MessageType.DATA,
                connectionId,
                data: data.toString('base64')
            }));
        }
    });
    socket.on('close', () => {
        log(`Local socket closed for ${connectionId}`);
        if (ws && ws.readyState === ws_1.WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: protocol_1.MessageType.CLOSE,
                connectionId
            }));
        }
        activeTunnels.delete(connectionId);
        updateTunnelCount();
    });
    socket.on('error', (err) => {
        log(`Local socket error on ${connectionId}: ${err.message}`);
        socket.destroy();
    });
}
function updateTunnelCount() {
    sendToUI('update-state', { activeTunnels: activeTunnels.size });
}
electron_1.app.whenReady().then(() => {
    createWindow();
    // Give UI a moment to load before connecting
    setTimeout(() => {
        sendToUI('update-state', { agentId, cloudUrl });
        connectToCloud();
    }, 1000);
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
