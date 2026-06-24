const net = require('net');
const configManager = require('../config/config');
const { getLogger, logTraffic } = require('../utils/logger');

class PortForwarder {
  constructor(mode) {
    this.mode = mode;
    this.servers = new Map(); // listenPort -> net.Server
    this.currentSession = null;
  }

  setSession(session) {
    this.currentSession = session;
    if (!session) return;
    
    // Listen for incoming channel requests from remote
    session.on('channel', (channel) => {
      const { meta } = channel;
      if (meta && meta.type === 'forward') {
        this.handleIncomingForward(channel, meta.host, meta.port);
      }
    });
  }

  handleIncomingForward(channel, host, port) {
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
      logTraffic(`Forward Incoming (${this.mode})`, `to ${host}:${port}`, socket.bytesRead + socket.bytesWritten);
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
        this.servers.delete(listenPort);
        getLogger().info(`[Forward-${this.mode}] Stopped listening on port ${listenPort}`);
      }
    }

    // Start new forwards
    for (const fw of desiredForwards) {
      if (!this.servers.has(fw.listenPort)) {
        this.startForward(fw.listenPort);
      }
    }
  }

  startForward(listenPort) {
    const server = net.createServer((socket) => {
      const currentConfig = configManager.getConfig()[this.mode]?.forwards.find(f => f.listenPort === listenPort);
      if (!currentConfig) {
        socket.destroy();
        return;
      }
      const { targetHost, targetPort } = currentConfig;

      if (!this.currentSession) {
        getLogger().warn(`[Forward-${this.mode}] No active tunnel session, dropping connection`);
        socket.destroy();
        return;
      }
      
      getLogger().info(`[Forward-${this.mode}] New connection on local port ${listenPort}, tunneling to ${targetHost}:${targetPort}`);
      
      const channel = this.currentSession.createChannel({
        type: 'forward',
        host: targetHost,
        port: targetPort
      });

      socket.pipe(channel);
      channel.pipe(socket);

      socket.on('error', () => channel.end());
      channel.on('error', () => socket.destroy());
      
      socket.on('close', () => {
        logTraffic(`Forward Outgoing (${this.mode})`, `from :${listenPort} to ${targetHost}:${targetPort}`, socket.bytesRead + socket.bytesWritten);
      });
    });

    server.listen(listenPort, '0.0.0.0', () => {
      getLogger().info(`[Forward-${this.mode}] Listening on ${listenPort} (dynamic target)`);
      this.servers.set(listenPort, server);
    });

    server.on('error', (err) => {
      getLogger().error(`[Forward-${this.mode}] Failed to listen on ${listenPort}: ${err.message}`);
    });
  }
}

module.exports = PortForwarder;
