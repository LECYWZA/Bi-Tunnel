const tls = require('tls');
const { EventEmitter } = require('events');
const { MuxSession } = require('./multiplexer');
const configManager = require('../config/config');
const { getLogger } = require('../utils/logger');

class TunnelClient extends EventEmitter {
  constructor() {
    super();
    this.session = null;
    this.retryTimeout = null;
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
    if (this.session) {
      this.session.close();
      this.session = null;
    }
  }

  connect() {
    if (this.session) return;
    
    const config = configManager.getConfig();
    const clientConfig = config.client || {};
    getLogger().info(`[TLS] Connecting to ${clientConfig.tunnelHost}:${clientConfig.tunnelPort}...`);
    
    const socket = tls.connect(clientConfig.tunnelPort, clientConfig.tunnelHost, {
      rejectUnauthorized: false // We use self-signed certs
    }, () => {
      getLogger().info('[TLS] Secure connection established, authenticating...');
      const session = new MuxSession(socket, false);
      this.session = session;
      
      session.sendAuth(clientConfig.password);
      
      session.on('auth_res', (ok) => {
        if (ok) {
          getLogger().info('Authentication successful');
          this.emit('session', session);
        } else {
          getLogger().warn('Authentication failed');
          session.close();
        }
      });
      
      session.on('close', () => {
        getLogger().info('Connection closed');
        this.session = null;
        this.emit('session_closed');
        this.scheduleRetry();
      });

      session.on('error', (err) => {
        getLogger().error(`Session error: ${err.message}`);
      });
    });

    socket.on('error', (err) => {
      getLogger().error(`Socket error: ${err.message}`);
      this.scheduleRetry();
    });
  }

  scheduleRetry() {
    if (!this.shouldRetry) return;
    if (this.retryTimeout) clearTimeout(this.retryTimeout);
    this.retryTimeout = setTimeout(() => {
      getLogger().info('Retrying connection...');
      this.connect();
    }, 3000);
  }

  getSession() {
    return this.session && this.session.isAuthenticated ? this.session : null;
  }
}

module.exports = new TunnelClient();
