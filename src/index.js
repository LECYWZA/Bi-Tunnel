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
    })) : [],
    tun: require('./core/xrayManager').getTunStatus()
  }));

  // Bind tunnelServer events once globally
  tunnelServer.on('session', (session, clientId) => {
    getLogger().info(`=== Server Tunnel Session Established [${clientId}] ===`);
    serverForwarder.setSession(session, clientId);
    serverProxy.setSession(session, clientId);
    
    if (webApp.locals.broadcastClientsUpdate) {
      webApp.locals.broadcastClientsUpdate();
    }
  });

  tunnelServer.on('session_closed', (clientId) => {
    getLogger().info(`=== Server Tunnel Session Closed [${clientId}] ===`);
    serverForwarder.removeSession(clientId);
    serverProxy.removeSession(clientId);
    
    if (webApp.locals.broadcastClientsUpdate) {
      webApp.locals.broadcastClientsUpdate();
    }
  });

  // Bind tunnelClient events once globally
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

  const startTunnel = async (mode) => {
    try {
      if (mode === 'server') {
        if (tunnelServer.server) return; // already running
        await tunnelServer.start();
      } else if (mode === 'client') {
        if (tunnelClient.shouldRetry) return; // already running
        tunnelClient.start();
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
      serverForwarder.clearSessions();
      serverProxy.clearSessions();
      
      // Immediately notify the UI that all clients are offline now
      if (webApp.locals.broadcastClientsUpdate) {
        webApp.locals.broadcastClientsUpdate();
      }
    } else if (mode === 'client') {
      if (tunnelClient.stop) tunnelClient.stop();
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

    // 广播端口映射启动错误给前端（携带 mode + port 以便前端回滚对应开关）
    const broadcastForwardError = (mode, err) => {
      if (err && err.code === 'PORT_IN_USE') {
        getLogger().error(`[Forward-${mode}] Port ${err.port} already in use`);
        if (webApp.locals.broadcastWsMessage) {
          webApp.locals.broadcastWsMessage({
            type: 'forward_error',
            data: { mode, port: err.port, message: `端口 ${err.port} 已被占用，端口映射启动失败` }
          });
        }
      } else {
        getLogger().error(`[Forward-${mode}] applyConfig error: ` + (err && err.message ? err.message : JSON.stringify(err)));
      }
    };
    serverForwarder.applyConfig().catch(err => broadcastForwardError('server', err));
    serverProxy.applyConfig().catch(err => getLogger().error('[Proxy-server] applyConfig error: ' + JSON.stringify(err)));

    if (tunnelClient && typeof tunnelClient.applyConfig === 'function') {
      tunnelClient.applyConfig();
    }
    clientForwarder.applyConfig().catch(err => broadcastForwardError('client', err));
    clientProxy.applyConfig().catch(err => getLogger().error('[Proxy-client] applyConfig error: ' + JSON.stringify(err)));
    
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
  serverForwarder.applyConfig().catch(err => getLogger().error('[Forward-server] applyConfig error: ' + JSON.stringify(err)));
  serverProxy.applyConfig().catch(err => getLogger().error('[Proxy-server] applyConfig error: ' + JSON.stringify(err)));
  clientForwarder.applyConfig().catch(err => getLogger().error('[Forward-client] applyConfig error: ' + JSON.stringify(err)));
  clientProxy.applyConfig().catch(err => getLogger().error('[Proxy-client] applyConfig error: ' + JSON.stringify(err)));

  // Auto start TUN mode and system proxy if enabled in config
  if (config.tunModeEnabled && config.tunProxyPort) {
    getLogger().info(`Auto-starting TUN mode on port ${config.tunProxyPort}...`);
    const xrayManager = require('./core/xrayManager');
    (async () => {
      try {
        const routeManager = require('./utils/routeManager');
        const gatewayInfo = await routeManager.getDefaultGateway();
        
        const dns = require('dns').promises;
        async function resolveHost(host) {
          if (!host) return null;
          const net = require('net');
          if (net.isIP(host)) return host;
          try {
            const res = await dns.lookup(host);
            return res.address;
          } catch (e) {
            return null;
          }
        }

        if (gatewayInfo) {
          const hostsToResolve = [];
          if (config.mode === 'client' && config.client?.tunnelHost) {
            hostsToResolve.push(config.client.tunnelHost);
          }
          if (config.proxyNodes) {
            config.proxyNodes.forEach(node => {
              if (node.host) hostsToResolve.push(node.host);
            });
          }

          const ipSet = new Set();
          for (const host of hostsToResolve) {
            const ip = await resolveHost(host);
            if (ip) ipSet.add(ip);
          }

          for (const ip of ipSet) {
            await routeManager.addBypassRoute(ip, gatewayInfo);
          }
        }
        await xrayManager.startTun(config.tunProxyPort);
      } catch (err) {
        getLogger().error(`Auto-start TUN mode failed: ${err.message}`);
      }
    })();
  }

  if (config.globalProxyEnabled && config.globalProxyPort) {
    getLogger().info(`Auto-starting Global System Proxy on port ${config.globalProxyPort}...`);
    const { enableSystemProxy } = require('./utils/systemProxy');
    enableSystemProxy('127.0.0.1', config.globalProxyPort).catch(err => {
      getLogger().error(`Auto-start Global System Proxy failed: ${err.message}`);
    });
  }
}

// Global unhandled rejections to prevent crash
process.on('uncaughtException', (err) => getLogger().error('Uncaught Exception: ' + err.message));
process.on('unhandledRejection', (err) => getLogger().error('Unhandled Rejection: ' + err));

// Handle graceful shutdown
process.on('SIGINT', async () => {
  getLogger().info('\nShutting down gracefully...');
  const { stopXray, stopTun } = require('./core/xrayManager');
  const { disableSystemProxy } = require('./utils/systemProxy');
  const routeManager = require('./utils/routeManager');
  const trafficLogger = require('./utils/trafficLogger');

  try { trafficLogger.saveSync(); } catch (e) {}
  try { await disableSystemProxy(); } catch (e) {}
  try { await routeManager.clearAllBypasses(); } catch (e) {}
  
  stopXray();
  stopTun().catch(() => {}).finally(() => {
    process.exit(0);
  });
});

init();
