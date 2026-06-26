const net = require('net');
const configManager = require('../config/config');
const { getLogger, logTraffic } = require('../utils/logger');
const trafficLogger = require('../utils/trafficLogger');

class PortForwarder {
  constructor(mode) {
    this.mode = mode;
    this.servers = new Map(); // listenPort -> net.Server
    this.sessions = new Map(); // clientId -> session
  }

  setSession(session, clientId) {
    this.sessions.set(clientId, session);
    
    // Listen for incoming channel requests from remote
    session.on('channel', (channel) => {
      const { meta } = channel;
      if (meta && meta.type === 'forward') {
        this.handleIncomingForward(channel, meta.host, meta.port, socket => socket.remoteAddress);
      }
    });
  }

  removeSession(clientId) {
    this.sessions.delete(clientId);
  }

  clearSessions() {
    this.sessions.clear();
  }

  handleIncomingForward(channel, host, port, getSourceIp) {
    getLogger().info(`[Forward-${this.mode}] Received forward request to ${host}:${port}, attempting connection...`);
    const socket = new net.Socket();
    socket.connect(port, host, () => {
      getLogger().info(`[Forward-${this.mode}] Accepted incoming connection to ${host}:${port}`);
      channel.pipe(socket);
      socket.pipe(channel);
    });
    
    socket.on('error', (err) => {
      getLogger().error(`[Forward-${this.mode}] Failed to connect to ${host}:${port}: ${err.message}`);
      channel.end();
    });

    socket.on('close', () => {
      const bytes = socket.bytesRead + socket.bytesWritten;
      logTraffic(`Forward Incoming (${this.mode})`, `to ${host}:${port}`, bytes);
      trafficLogger.addLog({
        module: `Forward Incoming (${this.mode})`,
        target: `${host}:${port}`,
        action: 'reverse_forward',
        bytesTransferred: bytes,
        status: 'success'
      });
    });

    channel.on('error', () => {
      socket.destroy();
    });
  }

  applyConfig() {
    if (!this.mode || this.mode === 'none') return;
    const config = configManager.getConfig();
    const modeConfig = config[this.mode] || {};
    const desiredForwards = modeConfig.forwards || [];

    // Stop removed forwards
    for (const [listenPort, server] of this.servers.entries()) {
      if (!desiredForwards.find(f => f.listenPort === listenPort)) {
        server.close();
        if (server._sockets) {
          for (const s of server._sockets) {
            s.destroy();
          }
        }
        this.servers.delete(listenPort);
        getLogger().info(`[Forward-${this.mode}] Stopped listening on port ${listenPort}`);
      }
    }

    // Start new forwards
    const startPromises = [];
    for (const fw of desiredForwards) {
      if (!this.servers.has(fw.listenPort)) {
        startPromises.push(this.startForward(fw.listenPort));
      }
    }
    return Promise.all(startPromises);
  }

  startForward(listenPort) {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
      if (!server._sockets) server._sockets = new Set();
      server._sockets.add(socket);
      socket.on('close', () => server._sockets.delete(socket));

      const currentConfig = configManager.getConfig()[this.mode]?.forwards.find(f => f.listenPort === listenPort);
      if (!currentConfig) {
        socket.destroy();
        return;
      }
      const { targetHost, targetPort, targetClientId } = currentConfig;
      
      let targetSession;
      if (this.mode === 'server') {
        const clientId = targetClientId || 'client-1';
        targetSession = this.sessions.get(clientId);
        if (!targetSession && this.sessions.size === 1) {
          targetSession = this.sessions.values().next().value;
        }
      } else {
        const serverConnId = targetClientId || 'default';
        targetSession = this.sessions.get(serverConnId);
        if (!targetSession && this.sessions.size === 1) {
          targetSession = this.sessions.values().next().value;
        }
      }

      if (!targetSession) {
        getLogger().warn(`[Forward-${this.mode}] No active tunnel session for client ${targetClientId || 'client-1'}, dropping connection`);
        socket.destroy();
        return;
      }
      
      getLogger().info(`[Forward-${this.mode}] New connection on local port ${listenPort}, tunneling to ${targetHost}:${targetPort}`);
      const startTime = Date.now();
      
      const channel = targetSession.createChannel({
        type: 'forward',
        host: targetHost,
        port: targetPort
      });

      socket.pipe(channel);
      channel.pipe(socket);

      socket.on('error', () => channel.end());
      channel.on('error', () => socket.destroy());
      
      socket.on('close', () => {
        const bytes = socket.bytesRead + socket.bytesWritten;
        logTraffic(`Forward Outgoing (${this.mode})`, `to ${targetHost}:${targetPort}`, bytes);
        trafficLogger.addLog({
          module: `Forward Outgoing (${this.mode})`,
          sourceIp: socket.remoteAddress,
          target: `${targetHost}:${targetPort}`,
          action: 'forward',
          bytesTransferred: bytes,
          durationMs: Date.now() - startTime,
          status: 'success'
        });
      });
    });

    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject({ code: 'PORT_IN_USE', port: listenPort });
      } else {
        getLogger().error(`[Forward-${this.mode}] Failed to listen on ${listenPort}: ${err.message}`);
        reject(err);
      }
    });

    server.listen(listenPort, '0.0.0.0', () => {
      getLogger().info(`[Forward-${this.mode}] Listening on ${listenPort} (dynamic target)`);
      this.servers.set(listenPort, server);
      resolve();
    });
  });
}
}

module.exports = PortForwarder;
