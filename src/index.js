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
    connectedClients: tunnelServer.sessions ? Array.from(tunnelServer.sessions.keys()) : []
  }));

  const startTunnel = async (mode) => {
    try {
      if (mode === 'server') {
        if (tunnelServer.server) return; // already running
        await tunnelServer.start();
        
        await Promise.all([
          serverForwarder.applyConfig(),
          serverProxy.applyConfig()
        ]);
        
        tunnelServer.on('session', (session, clientId) => {
          getLogger().info(`=== Server Tunnel Session Established [${clientId}] ===`);
          serverForwarder.setSession(session, clientId);
          serverProxy.setSession(session, clientId);
        });

        tunnelServer.on('session_closed', (clientId) => {
          getLogger().info(`=== Server Tunnel Session Closed [${clientId}] ===`);
          serverForwarder.removeSession(clientId);
          serverProxy.removeSession(clientId);
        });
      } else if (mode === 'client') {
        if (tunnelClient.shouldRetry) return; // already running
        tunnelClient.start(); // client connect doesn't bind a listen port, so it doesn't throw EADDRINUSE normally
        
        await Promise.all([
          clientForwarder.applyConfig(),
          clientProxy.applyConfig()
        ]);
        
        tunnelClient.on('session', (session) => {
          getLogger().info('=== Client Tunnel Session Established ===');
          clientForwarder.setSession(session, 'server');
          clientProxy.setSession(session, 'server');
        });

        tunnelClient.on('session_closed', () => {
          getLogger().info('=== Client Tunnel Session Closed ===');
          clientForwarder.removeSession('server');
          clientProxy.removeSession('server');
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
                              
    const clientCoreChanged = newConfig.client.tunnelPort !== oldConfig.client.tunnelPort || 
                              newConfig.client.tunnelHost !== oldConfig.client.tunnelHost || 
                              newConfig.client.password !== oldConfig.client.password;

    if (serverCoreChanged && tunnelServer.server) {
      getLogger().info('Server core config changed, restarting server tunnel...');
      stopTunnel('server');
      startTunnel('server');
    } else {
      serverForwarder.applyConfig();
      serverProxy.applyConfig();
    }

    if (clientCoreChanged && tunnelClient.shouldRetry) {
      getLogger().info('Client core config changed, restarting client tunnel...');
      stopTunnel('client');
      startTunnel('client');
    } else {
      clientForwarder.applyConfig();
      clientProxy.applyConfig();
    }
    
    lastConfigStr = newConfigStr;
  };

  // Auto start based on config
  if (config.server && config.server.autoStart) {
    startTunnel('server');
  }
  if (config.client && config.client.autoStart) {
    startTunnel('client');
  }
  if (!config.server?.autoStart && !config.client?.autoStart) {
    getLogger().info('Auto-start is disabled for both modes.');
  }
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
