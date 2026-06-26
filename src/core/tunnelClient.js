const tls = require('tls');
const { EventEmitter } = require('events');
const { MuxSession } = require('./multiplexer');
const configManager = require('../config/config');
const { getLogger } = require('../utils/logger');

class SingleTunnelClient extends EventEmitter {
  constructor(connConfig) {
    super();
    this.config = connConfig;
    this.session = null;
    this.retryTimeout = null;
    this.shouldRetry = false;
    this.status = 'stopped';
  }

  start() {
    this.shouldRetry = true;
    this.connect();
  }

  stop() {
    this.shouldRetry = false;
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
    this.status = 'stopped';
    if (this.session) {
      this.session.close();
      this.session = null;
    }
  }

  connect() {
    if (this.session) return;
    
    const clientConfig = this.config;
    getLogger().info(`[TLS] [${clientConfig.alias}] Connecting to ${clientConfig.tunnelHost}:${clientConfig.tunnelPort}...`);
    this.status = 'connecting';
    
    const socket = tls.connect(clientConfig.tunnelPort, clientConfig.tunnelHost, {
      rejectUnauthorized: false // We use self-signed certs
    }, () => {
      getLogger().info(`[TLS] [${clientConfig.alias}] Secure connection established, authenticating...`);
      const session = new MuxSession(socket, false);
      this.session = session;
      
      const authPayload = JSON.stringify({
        password: clientConfig.password,
        clientId: clientConfig.clientId || 'client-1'
      });
      session.sendAuth(authPayload);
      
      session.on('auth_res', (ok) => {
        if (ok) {
          getLogger().info(`[TLS] [${clientConfig.alias}] Authentication successful`);
          this.status = 'connected';
          this.emit('session', session);
        } else {
          getLogger().warn(`[TLS] [${clientConfig.alias}] Authentication failed`);
          this.status = 'failed';
          session.close();
        }
      });
      
      session.on('close', () => {
        getLogger().info(`[TLS] [${clientConfig.alias}] Connection closed`);
        this.session = null;
        this.emit('session_closed');
        this.scheduleRetry();
      });

      session.on('error', (err) => {
        getLogger().error(`[TLS] [${clientConfig.alias}] Session error: ${err.message}`);
      });
    });

    socket.on('error', (err) => {
      getLogger().error(`[TLS] [${clientConfig.alias}] Socket error: ${err.message}`);
      this.status = 'failed';
      this.scheduleRetry();
    });
  }

  scheduleRetry() {
    if (!this.shouldRetry) return;
    if (this.retryTimeout) clearTimeout(this.retryTimeout);
    this.retryTimeout = setTimeout(() => {
      getLogger().info(`[TLS] [${this.config.alias}] Retrying connection...`);
      this.connect();
    }, 3000);
  }

  getSession() {
    return this.session && this.session.isAuthenticated ? this.session : null;
  }
}

class TunnelClientManager extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map(); // Map<connectionId, SingleTunnelClient>
    this.shouldRetry = false;
  }

  start() {
    this.shouldRetry = true;
    const config = configManager.getConfig();
    let connections = config.client?.connections || [];
    
    // Legacy migration dynamically handled
    if (connections.length === 0 && config.client?.tunnelHost) {
      connections.push({
        id: 'default',
        alias: '默认服务端',
        tunnelHost: config.client.tunnelHost,
        tunnelPort: config.client.tunnelPort,
        password: config.client.password,
        clientId: config.client.clientId || 'client-1',
        enabled: true
      });
      if (!config.client) config.client = {};
      config.client.connections = connections;
      configManager.saveConfig(config);
    }
    
    for (const conn of connections) {
      if (!conn.enabled) continue;
      this.startConnection(conn);
    }
  }
  
  startConnection(conn) {
     const client = new SingleTunnelClient(conn);
     this.clients.set(conn.id, client);
     
     client.on('session', (session) => this.emit('session', session, conn.id));
     client.on('session_closed', () => this.emit('session_closed', conn.id));
     
     try {
       client.start();
     } catch (err) {
       getLogger().error(`Client ${conn.alias} start error: ${err.message || err}`);
     }
  }

  stop() {
    this.shouldRetry = false;
    for (const client of this.clients.values()) {
      client.stop();
    }
    this.clients.clear();
  }

  applyConfig() {
    if (!this.shouldRetry) return; // Only apply if client mode is globally running
    const config = configManager.getConfig();
    const connections = config.client?.connections || [];
    
    // Stop removed or disabled connections
    for (const [id, client] of this.clients.entries()) {
      const conn = connections.find(c => c.id === id);
      if (!conn || !conn.enabled) {
         client.stop();
         this.clients.delete(id);
      }
    }
    
    // Start new and enabled connections
    for (const conn of connections) {
      if (conn.enabled && !this.clients.has(conn.id)) {
        this.startConnection(conn);
      }
    }
  }

  getSession(connectionId) {
    if (connectionId && this.clients.has(connectionId)) {
      return this.clients.get(connectionId).getSession();
    }
    // Fallback if not specified and only one exists (e.g. for simple setups)
    if (this.clients.size === 1) {
       return this.clients.values().next().value.getSession();
    }
    return null;
  }
}

module.exports = new TunnelClientManager();
