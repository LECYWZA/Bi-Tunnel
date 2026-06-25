const net = require('net');
const ProxyServer = require('./src/core/proxyServer');
const configManager = require('./src/config/config');

configManager.getConfig = () => ({
  test: {
    proxies: [{
      listenPort: 10800,
      listenIp: '127.0.0.1',
      useAuth: true,
      user: 'admin',
      pass: 'admin',
      useRemoteNetwork: false,
      allowIps: [],
      denyIps: [],
      targetAllowIps: [],
      targetDenyIps: []
    }]
  }
});

const proxy = new ProxyServer('test');
proxy.startProxy(10800);
