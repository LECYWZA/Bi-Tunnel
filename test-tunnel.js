const configManager = require('./src/config/config');
const tunnelServer = require('./src/core/tunnelServer');
const tunnelClient = require('./src/core/tunnelClient');
const ProxyServer = require('./src/core/proxyServer');

configManager.getConfig = () => ({
  server: {
    bindHost: '0.0.0.0',
    tunnelPort: 33891,
    password: 'admin',
    forwards: [],
    proxies: []
  },
  client: {
    tunnelHost: '127.0.0.1',
    tunnelPort: 33891,
    password: 'admin',
    forwards: [],
    proxies: [{
      listenPort: 1113,
      useAuth: true,
      user: 'test',
      pass: 'test',
      useRemoteNetwork: true, // Use the tunnel!
      allowIps: [],
      denyIps: [],
      targetAllowIps: [],
      targetDenyIps: [],
      listenIp: '127.0.0.1'
    }]
  }
});

tunnelServer.start();

setTimeout(() => {
  tunnelClient.start();
  
  setTimeout(() => {
    const proxy = new ProxyServer('client');
    proxy.setSession(tunnelClient.getSession());
    proxy.applyConfig(); // starts on 1113
    
    console.log("Started test tunnel and proxy");
  }, 1000);
}, 1000);
