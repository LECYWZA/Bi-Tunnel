const tls = require('tls');
const { EventEmitter } = require('events');
const { MuxSession } = require('./multiplexer');
const configManager = require('../config/config');
const { getLogger } = require('../utils/logger');
const { getCertificates } = require('../utils/tlsGenerator');

class TunnelServer extends EventEmitter {
  constructor() {
    super();
    this.server = null;
    this.sessions = new Map(); // Map<clientId, TunnelSession>
    this.clientStats = new Map(); // Maps clientId to connection data
  }

  start() {
    return new Promise((resolve, reject) => {
      const config = configManager.getConfig();
      const serverConfig = config.server || {};
      const certs = getCertificates();

    this.server = tls.createServer({
      key: certs.key,
      cert: certs.cert
    }, (socket) => {
      getLogger().info(`[TLS] Client connected from ${socket.remoteAddress}`);
      
      const session = new MuxSession(socket, true);
      let sessionClientId = null;
      
      session.on('auth', (authData) => {
        const password = typeof authData === 'object' ? authData.password : authData;
        const clientId = typeof authData === 'object' ? authData.clientId : 'legacy-client';

        const currentConfig = configManager.getConfig();
        const currentServerConfig = currentConfig.server || {};

        if (password === currentServerConfig.password) {
          // If a session with this ID already exists, close it
          if (this.sessions.has(clientId)) {
            getLogger().info(`[TLS] Session for ${clientId} already exists, closing old one`);
            this.sessions.get(clientId).close();
          }

          if (!currentServerConfig.knownClients) currentServerConfig.knownClients = [];
          let clientEntry = currentServerConfig.knownClients.find(c => c.id === clientId);
          if (!clientEntry) {
            clientEntry = { id: clientId, firstSeen: Date.now() };
            currentServerConfig.knownClients.push(clientEntry);
          }
          clientEntry.lastConnected = Date.now();
          clientEntry.online = true;
          this.clientStats.set(clientId, { connectTime: Date.now() });
          configManager.saveConfig(currentConfig);

          session.sendAuthRes(true);
          getLogger().info(`[TLS] Client '${clientId}' authenticated successfully`);
          sessionClientId = clientId;
          this.sessions.set(clientId, session);
          this.emit('session', session, clientId);
        } else {
          session.sendAuthRes(false);
          getLogger().warn(`[TLS] Client authentication failed from ${socket.remoteAddress}`);
          socket.destroy();
        }
      });

      session.on('close', () => {
        getLogger().info(`[TLS] Client ${sessionClientId || socket.remoteAddress} disconnected`);
        if (sessionClientId && this.sessions.get(sessionClientId) === session) {
          const currentConfig = configManager.getConfig();
          if (currentConfig.server && currentConfig.server.knownClients) {
            const clientEntry = currentConfig.server.knownClients.find(c => c.id === sessionClientId);
            if (clientEntry) {
              clientEntry.online = false;
              if (this.clientStats.has(sessionClientId)) {
                const stats = this.clientStats.get(sessionClientId);
                clientEntry.totalDuration = (clientEntry.totalDuration || 0) + (Date.now() - stats.connectTime);
                this.clientStats.delete(sessionClientId);
              }
              configManager.saveConfig(currentConfig);
            }
          }
          this.sessions.delete(sessionClientId);
          this.emit('session_closed', sessionClientId);
        }
      });

      session.on('error', (err) => {
        getLogger().error(`Session error: ${err.message}`);
      });
    });
    
    this.server.on('tlsClientError', (err, tlsSocket) => {
       getLogger().warn(`[TLS] Handshake failed from ${tlsSocket.remoteAddress}: ${err.message}`);
    });

    const bindHost = serverConfig.bindHost || '0.0.0.0';

    this.server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject({ code: 'PORT_IN_USE', port: serverConfig.tunnelPort });
      } else {
        getLogger().error(`[TLS] Server error: ${err.message}`);
        reject(err);
      }
    });

    this.server.listen(serverConfig.tunnelPort, bindHost, () => {
      getLogger().info(`[TLS] Tunnel Server listening on ${bindHost}:${serverConfig.tunnelPort}`);
      resolve();
    });
  });
}

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    
    // Mark all active sessions as offline
    const config = configManager.getConfig();
    let configChanged = false;
    if (config.server && config.server.knownClients) {
      for (const clientId of this.sessions.keys()) {
        const clientEntry = config.server.knownClients.find(c => c.id === clientId);
        if (clientEntry && clientEntry.online) {
          clientEntry.online = false;
          configChanged = true;
          if (this.clientStats.has(clientId)) {
            const stats = this.clientStats.get(clientId);
            clientEntry.totalDuration = (clientEntry.totalDuration || 0) + (Date.now() - stats.connectTime);
            this.clientStats.delete(clientId);
          }
        }
      }
    }
    if (configChanged) {
      configManager.saveConfig(config);
    }

    for (const session of this.sessions.values()) {
      session.close();
    }
    this.sessions.clear();
  }

  getSession(clientId = 'client-1') {
    // If clientId is provided, get that specific session
    if (this.sessions.has(clientId)) {
      const session = this.sessions.get(clientId);
      return session.isAuthenticated ? session : null;
    }
    
    // If not found or not specified, and there's only 1 session, fallback to it
    if (this.sessions.size === 1) {
      const session = this.sessions.values().next().value;
      return session.isAuthenticated ? session : null;
    }
    
    return null;
  }
}

module.exports = new TunnelServer();
