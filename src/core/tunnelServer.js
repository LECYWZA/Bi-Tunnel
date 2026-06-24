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
    this.session = null;
  }

  start() {
    const config = configManager.getConfig();
    const serverConfig = config.server || {};
    const certs = getCertificates();

    this.server = tls.createServer({
      key: certs.key,
      cert: certs.cert
    }, (socket) => {
      getLogger().info(`[TLS] Client connected from ${socket.remoteAddress}`);
      
      if (this.session) {
        getLogger().info('A session already exists, closing old one');
        this.session.close();
      }

      const session = new MuxSession(socket, true);
      
      session.on('auth', (password) => {
        if (password === serverConfig.password) {
          session.sendAuthRes(true);
          getLogger().info('Client authenticated successfully');
          this.session = session;
          this.emit('session', session);
        } else {
          session.sendAuthRes(false);
          getLogger().warn('Client authentication failed');
          socket.destroy();
        }
      });

      session.on('close', () => {
        getLogger().info('Client disconnected');
        if (this.session === session) {
          this.session = null;
          this.emit('session_closed');
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
    this.server.listen(serverConfig.tunnelPort, bindHost, () => {
      getLogger().info(`[TLS] Tunnel Server listening on ${bindHost}:${serverConfig.tunnelPort}`);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    if (this.session) {
      this.session.close();
      this.session = null;
    }
  }

  getSession() {
    return this.session && this.session.isAuthenticated ? this.session : null;
  }
}

module.exports = new TunnelServer();
