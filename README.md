# Remote Tunnel System

This is a production-oriented TCP tunneling system, designed to allow public cloud access to services running inside a local client's network. It uses a bidirectional TCP byte-stream tunnel over WebSocket.

## Architecture

- **Cloud Server**: Node.js WebSocket server that accepts incoming connections and routes traffic over the tunnel.
- **Client Agent**: Electron + Vite application that maintains a persistent connection to the cloud server and proxies TCP traffic to local targets.

## Quick Start

### 1. Setup

Install dependencies for all projects.

```bash
cd cloud-server
npm install

cd ../client-agent
npm install
```

### 2. Start Cloud Server

```bash
cd cloud-server
npm run dev
```

The cloud server dashboard will be available at `http://localhost:3000`.

### 3. Start Client Agent

```bash
cd client-agent
npm run dev
```

In a separate terminal:

```bash
cd client-agent
npm start
```

### 4. Testing the Tunnel

The cloud server is configured to map:
- Port `8080` -> `agent-001` -> local `5000`
- Port `8081` -> `agent-001` -> local `80`
- Port `8082` -> `agent-001` -> local `443`

1. Start a local server on port 5000 (e.g., `python -m http.server 5000`).
2. Make a request to the cloud server's public endpoint: `curl http://localhost:8080`.
3. The request will route through the tunnel to your local Python server.
