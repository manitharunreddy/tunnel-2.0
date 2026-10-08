import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { WebSocket } from 'ws';
import * as net from 'net';
import * as dotenv from 'dotenv';
import { MessageType, TunnelMessage } from '../../shared/protocol';

dotenv.config({ path: path.join(__dirname, '../../.env') });

let mainWindow: BrowserWindow | null = null;
let ws: WebSocket | null = null;
let reconnectAttempts = 0;
let isConnected = false;
let heartbeatInterval: NodeJS.Timeout | null = null;
const activeTunnels = new Map<string, net.Socket>();

const agentId = process.env.AGENT_ID || 'agent-001';
const agentSecret = process.env.AGENT_SECRET || 'secret-token-123';
const cloudUrl = process.env.CLOUD_URL || 'ws://localhost:3000/tunnel';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

function sendToUI(channel: string, data: any) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function log(message: string) {
  const timestamp = new Date().toLocaleTimeString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  sendToUI('log', logMessage);
}

function startHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: MessageType.PING }));
      log('Heartbeat sent');
      sendToUI('update-state', { lastHeartbeat: new Date().toISOString() });
    }
  }, 300000); // 5 minutes
}

function connectToCloud() {
  log(`Connecting to cloud: ${cloudUrl} (Attempt ${reconnectAttempts + 1})`);
  
  try {
    ws = new WebSocket(cloudUrl);
  } catch (err) {
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
        type: MessageType.REGISTER,
        agentId,
        agentSecret
      }));
    }
    
    startHeartbeat();
  });

  ws.on('message', (data) => {
    try {
      const msg: TunnelMessage = JSON.parse(data.toString());
      
      switch (msg.type) {
        case MessageType.REGISTER_ACK:
          if (msg.success) {
            log('Registered successfully');
          } else {
            log(`Registration failed: ${msg.message}`);
          }
          break;
          
        case MessageType.OPEN:
          log(`Opening local tunnel to ${msg.host}:${msg.port} for ${msg.connectionId}`);
          createLocalTunnel(msg.connectionId, msg.host, msg.port);
          break;
          
        case MessageType.DATA:
          const socket = activeTunnels.get(msg.connectionId);
          if (socket) {
            socket.write(Buffer.from(msg.data, 'base64'));
          }
          break;
          
        case MessageType.CLOSE:
          const tunnelToClose = activeTunnels.get(msg.connectionId);
          if (tunnelToClose) {
            tunnelToClose.end();
            activeTunnels.delete(msg.connectionId);
            log(`Tunnel ${msg.connectionId} closed by cloud`);
            updateTunnelCount();
          }
          break;
      }
    } catch (e) {
      log(`Error parsing message: ${e}`);
    }
  });

  ws.on('close', () => {
    log('Connection to cloud lost');
    isConnected = false;
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    
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
  if (isConnected) return;
  
  let delay = Math.pow(2, reconnectAttempts) * 1000;
  if (delay > 30000) delay = 30000; // max 30s backoff
  if (reconnectAttempts === 0) delay = 1000;
  if (reconnectAttempts === 1) delay = 2000;
  if (reconnectAttempts === 2) delay = 5000;
  if (reconnectAttempts === 3) delay = 10000;
  
  log(`Reconnecting in ${delay/1000}s...`);
  sendToUI('update-state', { status: 'Reconnecting', reconnectAttempts });
  
  reconnectAttempts++;
  setTimeout(connectToCloud, delay);
}

function createLocalTunnel(connectionId: string, host: string, port: number) {
  const socket = new net.Socket();
  
  socket.connect(port, host, () => {
    log(`Local tunnel established for ${connectionId}`);
    activeTunnels.set(connectionId, socket);
    updateTunnelCount();
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: MessageType.OPEN_ACK,
        connectionId,
        success: true
      }));
    }
  });

  socket.on('data', (data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: MessageType.DATA,
        connectionId,
        data: data.toString('base64')
      }));
    }
  });

  socket.on('close', () => {
    log(`Local socket closed for ${connectionId}`);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: MessageType.CLOSE,
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

app.whenReady().then(() => {
  createWindow();
  
  // Give UI a moment to load before connecting
  setTimeout(() => {
    sendToUI('update-state', { agentId, cloudUrl });
    connectToCloud();
  }, 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
