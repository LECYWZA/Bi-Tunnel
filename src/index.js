const configManager = require('./config/config');
const tunnelServer = require('./core/tunnelServer');
const tunnelClient = require('./core/tunnelClient');
const PortForwarder = require('./core/portForwarder');
const ProxyServer = require('./core/proxyServer');
const { createWebServer } = require('./web/api');
const { getLogger } = require('./utils/logger');

function init() {
  const logger = getLogger();
  logger.info('Starting Bi-Tunnel Application...');
  configManager.loadConfig();
  const config = configManager.getConfig();

  const serverForwarder = new PortForwarder('server');
  const serverProxy = new ProxyServer('server');
  const clientForwarder = new PortForwarder('client');
  const clientProxy = new ProxyServer('client');

  const webApp = createWebServer(() => ({
    serverConnected: tunnelServer.getSession() !== null,
    serverRunning: !!tunnelServer.server,
    clientConnected: tunnelClient.getSession() !== null,
    clientRunning: tunnelClient.shouldRetry // from our implementation
  }));

  const startTunnel = (mode) => {
    if (mode === 'server') {
      if (tunnelServer.server) return; // already running
      tunnelServer.start();
      
      tunnelServer.on('session', (session) => {
        getLogger().info('=== Server Tunnel Session Established ===');
        serverForwarder.setSession(session);
        serverProxy.setSession(session);
        serverForwarder.applyConfig();
        serverProxy.applyConfig();
      });

      tunnelServer.on('session_closed', () => {
        getLogger().info('=== Server Tunnel Session Closed ===');
        serverForwarder.setSession(null);
        serverProxy.setSession(null);
      });
    } else if (mode === 'client') {
      if (tunnelClient.shouldRetry) return; // already running
      tunnelClient.start();
      
      tunnelClient.on('session', (session) => {
        getLogger().info('=== Client Tunnel Session Established ===');
        clientForwarder.setSession(session);
        clientProxy.setSession(session);
        clientForwarder.applyConfig();
        clientProxy.applyConfig();
      });

      tunnelClient.on('session_closed', () => {
        getLogger().info('=== Client Tunnel Session Closed ===');
        clientForwarder.setSession(null);
        clientProxy.setSession(null);
      });
    }
  };

  const stopTunnel = (mode) => {
    if (mode === 'server') {
      if (tunnelServer.stop) tunnelServer.stop();
      tunnelServer.removeAllListeners('session');
      tunnelServer.removeAllListeners('session_closed');
      serverForwarder.setSession(null);
      serverProxy.setSession(null);
    } else if (mode === 'client') {
      if (tunnelClient.stop) tunnelClient.stop();
      tunnelClient.removeAllListeners('session');
      tunnelClient.removeAllListeners('session_closed');
      clientForwarder.setSession(null);
      clientProxy.setSession(null);
    }
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

init();
