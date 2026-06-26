const configManager = require('./config/config');
const tunnelServer = require('./core/tunnelServer');
const tunnelClient = require('./core/tunnelClient');
const PortForwarder = require('./core/portForwarder');
const ProxyServer = require('./core/proxyServer');
const { createWebServer } = require('./web/api');
const { getCertificates } = require('./utils/tlsGenerator');
const { downloadXray } = require('./utils/xrayDownloader');
const { stopXray } = require('./core/xrayManager');
const { getLogger } = require('./utils/logger');

function init() {
  const logger = getLogger();
  logger.info('Starting Bi-Tunnel Application...');
  
  // Download Xray-core in the background
  downloadXray().catch(e => getLogger().error('Xray download error: ' + e.message));

  configManager.loadConfig();
  const config = configManager.getConfig();

  const serverForwarder = new PortForwarder('server');
  const serverProxy = new ProxyServer('server');
  const clientForwarder = new PortForwarder('client');
  const clientProxy = new ProxyServer('client');

  const webApp = createWebServer(() => ({
    serverConnected: tunnelServer.sessions ? tunnelServer.sessions.size > 0 : false,
    serverRunning: !!tunnelServer.server,
    clientConnected: tunnelClient.getSession() !== null,
    clientRunning: tunnelClient.shouldRetry, // from our implementation
    connectedClients: tunnelServer.sessions ? Array.from(tunnelServer.sessions.keys()) : [],
    clientConnections: tunnelClient.clients ? Array.from(tunnelClient.clients.entries()).map(([id, c]) => ({
      id,
      status: c.status
    })) : []
  }));

  const startTunnel = async (mode) => {
    try {
      if (mode === 'server') {
        if (tunnelServer.server) return; // already running
        await tunnelServer.start();
        
          tunnelServer.on('session', (session, clientId) => {
          getLogger().info(`=== Server Tunnel Session Established [${clientId}] ===`);
          serverForwarder.setSession(session, clientId);
          serverProxy.setSession(session, clientId);
          
          if (webApp.locals.wss) {
            const clients = configManager.getConfig().server?.knownClients || [];
            webApp.locals.wss.clients.forEach(c => c.send(JSON.stringify({ type: 'clients_update', data: clients })));
          }
        });

        tunnelServer.on('session_closed', (clientId) => {
          getLogger().info(`=== Server Tunnel Session Closed [${clientId}] ===`);
          serverForwarder.removeSession(clientId);
          serverProxy.removeSession(clientId);
          
          if (webApp.locals.wss) {
            const clients = configManager.getConfig().server?.knownClients || [];
            webApp.locals.wss.clients.forEach(c => c.send(JSON.stringify({ type: 'clients_update', data: clients })));
          }
        });
      } else if (mode === 'client') {
        if (tunnelClient.shouldRetry) return; // already running
        tunnelClient.start();
        
        tunnelClient.on('session', (session, connId) => {
          getLogger().info(`=== Client Tunnel Session Established [${connId}] ===`);
          clientForwarder.setSession(session, connId);
          clientProxy.setSession(session, connId);
        });

        tunnelClient.on('session_closed', (connId) => {
          getLogger().info(`=== Client Tunnel Session Closed [${connId}] ===`);
          clientForwarder.removeSession(connId);
          clientProxy.removeSession(connId);
        });
      }
    } catch (e) {
      stopTunnel(mode);
      throw e;
    }
  };

  const stopTunnel = (mode) => {
    const { stopXray } = require('./core/xrayManager');
    if (mode === 'server') {
      if (tunnelServer.stop) tunnelServer.stop();
      tunnelServer.removeAllListeners('session');
      tunnelServer.removeAllListeners('session_closed');
      serverForwarder.clearSessions();
      serverProxy.clearSessions();
    } else if (mode === 'client') {
      if (tunnelClient.stop) tunnelClient.stop();
      tunnelClient.removeAllListeners('session');
      tunnelClient.removeAllListeners('session_closed');
      clientForwarder.clearSessions();
      clientProxy.clearSessions();
    }
    stopXray();
    getLogger().info('[Xray] Core stopped along with tunnel.');
  };

  // Bind to the web server app for API to call
  webApp.locals.startTunnel = startTunnel;
  webApp.locals.stopTunnel = stopTunnel;

  let lastConfigStr = JSON.stringify(config);

  webApp.locals.onConfigSaved = () => {
    const newConfigStr = JSON.stringify(configManager.getConfig());
    const newConfig = JSON.parse(newConfigStr);
    const oldConfig = JSON.parse(lastConfigStr);

    // Check if core server settings changed
    const serverCoreChanged = newConfig.server.tunnelPort !== oldConfig.server.tunnelPort || 
                              newConfig.server.bindHost !== oldConfig.server.bindHost || 
                              newConfig.server.password !== oldConfig.server.password;
                              
    if (serverCoreChanged && tunnelServer.server) {
      getLogger().info('Server core config changed, restarting server tunnel...');
      stopTunnel('server');
      startTunnel('server');
    }
    serverForwarder.applyConfig();
    serverProxy.applyConfig();

    if (tunnelClient.shouldRetry && typeof tunnelClient.applyConfig === 'function') {
      tunnelClient.applyConfig();
    }
    clientForwarder.applyConfig();
    clientProxy.applyConfig();
    
    lastConfigStr = newConfigStr;
  };

  // Auto start server based on config
  if (config.server && config.server.autoStart) {
    startTunnel('server').catch(err => {
      getLogger().error('Auto-start server failed: ' + (err.message || err));
    });
  } else {
    getLogger().info('Auto-start is disabled for server mode.');
  }

  // Client manager always runs (it manages individual enabled connections)
  startTunnel('client').catch(err => {
    getLogger().error('Auto-start client failed: ' + (err.message || err));
  });

  // Always apply port forwards and proxies regardless of tunnel status
  serverForwarder.applyConfig();
  serverProxy.applyConfig();
  clientForwarder.applyConfig();
  clientProxy.applyConfig();
}

// Global unhandled rejections to prevent crash
process.on('uncaughtException', (err) => getLogger().error('Uncaught Exception: ' + err.message));
process.on('unhandledRejection', (err) => getLogger().error('Unhandled Rejection: ' + err));

// Handle graceful shutdown
process.on('SIGINT', () => {
  getLogger().info('\nShutting down gracefully...');
  const { stopXray } = require('./core/xrayManager');
  stopXray();
  process.exit(0);
});

init();
