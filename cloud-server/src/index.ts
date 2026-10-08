import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import net from 'net';
import { MessageType, TunnelMessage } from '../../shared/protocol';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: process.env.WS_PATH || '/tunnel' });

interface AgentConnection {
  ws: WebSocket;
  agentId: string;
  status: 'ONLINE' | 'OFFLINE';
  lastSeen: Date;
  connectedAt: Date;
  activeTunnels: Map<string, net.Socket>;
}

const agents = new Map<string, AgentConnection>();

// Authentication config
const VALID_AGENTS = {
  'agent-001': 'secret-token-123'
};

interface PortMapping {
  publicPort: number;
  agentId: string;
  targetHost: string;
  targetPort: number;
  server?: net.Server;
}

const activeMappings = new Map<number, PortMapping>();

wss.on('connection', (ws) => {
  console.log('[Cloud] New WS connection attempt');
  let currentAgentId: string | null = null;

  ws.on('message', (message) => {
    try {
      const msg: TunnelMessage = JSON.parse(message.toString());
      
      switch (msg.type) {
        case MessageType.REGISTER:
          if (VALID_AGENTS[msg.agentId as keyof typeof VALID_AGENTS] === msg.agentSecret) {
            currentAgentId = msg.agentId;
            agents.set(msg.agentId, {
              ws,
              agentId: msg.agentId,
              status: 'ONLINE',
              lastSeen: new Date(),
              connectedAt: new Date(),
              activeTunnels: new Map()
            });
            console.log(`[Cloud] Agent ${msg.agentId} registered`);
            ws.send(JSON.stringify({ type: MessageType.REGISTER_ACK, success: true }));
          } else {
            console.warn(`[Cloud] Invalid register attempt for ${msg.agentId}`);
            ws.send(JSON.stringify({ type: MessageType.REGISTER_ACK, success: false, message: 'Unauthorized' }));
            ws.close();
          }
          break;

        case MessageType.PING:
          if (currentAgentId) {
            const agent = agents.get(currentAgentId);
            if (agent) {
              agent.lastSeen = new Date();
              ws.send(JSON.stringify({ type: MessageType.PONG }));
            }
          }
          break;

        case MessageType.DATA:
          if (currentAgentId) {
            const agent = agents.get(currentAgentId);
            if (agent) {
              const tunnel = agent.activeTunnels.get(msg.connectionId);
              if (tunnel) {
                tunnel.write(Buffer.from(msg.data, 'base64'));
              }
            }
          }
          break;

        case MessageType.CLOSE:
          if (currentAgentId) {
            const agent = agents.get(currentAgentId);
            if (agent) {
              const tunnel = agent.activeTunnels.get(msg.connectionId);
              if (tunnel) {
                tunnel.end();
                agent.activeTunnels.delete(msg.connectionId);
                console.log(`[Cloud] Tunnel ${msg.connectionId} closed by agent`);
              }
            }
          }
          break;
      }
    } catch (e) {
      console.error('[Cloud] Error parsing message', e);
    }
  });

  ws.on('close', () => {
    if (currentAgentId) {
      console.log(`[Cloud] Agent ${currentAgentId} disconnected`);
      const agent = agents.get(currentAgentId);
      if (agent) {
        agent.status = 'OFFLINE';
        // Cleanup active tunnels
        for (const [connId, socket] of agent.activeTunnels.entries()) {
          socket.destroy();
        }
        agent.activeTunnels.clear();
      }
    }
  });
});

// Dynamic Mappings API
app.get('/api/mappings', (req, res) => {
  const result = Array.from(activeMappings.values()).map(m => ({
    publicPort: m.publicPort,
    agentId: m.agentId,
    targetHost: m.targetHost,
    targetPort: m.targetPort
  }));
  res.json(result);
});

app.post('/api/mappings', (req, res) => {
  const { publicPort, agentId, targetHost, targetPort } = req.body;

  if (!publicPort || !agentId || !targetHost || !targetPort) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  if (activeMappings.has(publicPort)) {
    return res.status(400).json({ error: 'Port already mapped' });
  }

  const tcpServer = net.createServer((socket) => {
    const agent = agents.get(agentId);
    if (!agent || agent.status !== 'ONLINE') {
      console.log(`[Cloud] Connection rejected on port ${publicPort}, agent ${agentId} offline`);
      socket.destroy();
      return;
    }

    const connectionId = Math.random().toString(36).substring(2, 15);
    agent.activeTunnels.set(connectionId, socket);
    console.log(`[Cloud] New public connection on port ${publicPort} -> mapped to ${agentId} (${targetHost}:${targetPort}) as ${connectionId}`);

    agent.ws.send(JSON.stringify({
      type: MessageType.OPEN,
      connectionId,
      host: targetHost,
      port: targetPort
    }));

    socket.on('data', (data) => {
      if (agent.ws.readyState === WebSocket.OPEN) {
        agent.ws.send(JSON.stringify({
          type: MessageType.DATA,
          connectionId,
          data: data.toString('base64')
        }));
      }
    });

    socket.on('close', () => {
      console.log(`[Cloud] Public socket closed for ${connectionId}`);
      if (agent.ws.readyState === WebSocket.OPEN) {
        agent.ws.send(JSON.stringify({
          type: MessageType.CLOSE,
          connectionId
        }));
      }
      agent.activeTunnels.delete(connectionId);
    });
    
    socket.on('error', (err) => {
      console.error(`[Cloud] Socket error on ${connectionId}:`, err);
      socket.destroy();
    });
  });

  tcpServer.listen(publicPort, () => {
    console.log(`[Cloud] Dynamic TCP endpoint listening on port ${publicPort} for agent ${agentId}`);
    activeMappings.set(publicPort, {
      publicPort,
      agentId,
      targetHost,
      targetPort,
      server: tcpServer
    });
    res.json({ success: true });
  });

  tcpServer.on('error', (err) => {
    console.error(`[Cloud] Failed to listen on port ${publicPort}`, err);
    res.status(500).json({ error: `Failed to bind port ${publicPort}` });
  });
});

app.delete('/api/mappings/:port', (req, res) => {
  const port = parseInt(req.params.port, 10);
  const mapping = activeMappings.get(port);
  if (mapping && mapping.server) {
    mapping.server.close(() => {
      activeMappings.delete(port);
      console.log(`[Cloud] Closed listener on port ${port}`);
      res.json({ success: true });
    });
  } else {
    res.status(404).json({ error: 'Mapping not found' });
  }
});

// Dashboard API
app.get('/api/agents', (req, res) => {
  const result = Array.from(agents.values()).map(a => ({
    agentId: a.agentId,
    status: a.status,
    lastSeen: a.lastSeen,
    activeTunnelsCount: a.activeTunnels.size
  }));
  res.json(result);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Cloud] Dashboard & WebSocket server running on port ${PORT}`);
});
