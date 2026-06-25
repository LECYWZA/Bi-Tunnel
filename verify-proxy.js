const http = require('http');
const tls = require('tls');
const net = require('net');

const tunnelServer = require('./src/core/tunnelServer');
const tunnelClient = require('./src/core/tunnelClient');
const ProxyServer = require('./src/core/proxyServer');
const PortForwarder = require('./src/core/portForwarder');
const configManager = require('./src/config/config');

configManager.getConfig = () => ({
  server: { bindHost: '0.0.0.0', tunnelPort: 33899, password: 'admin', proxies: [{listenPort: 1121, listenIp: '0.0.0.0', useAuth: false, useRemoteNetwork: true}], forwards: [] },
  client: { tunnelHost: '127.0.0.1', tunnelPort: 33899, password: 'admin', proxies: [], forwards: [] }
});

const serverForwarder = new PortForwarder('server');
const serverProxy = new ProxyServer('server');
const clientForwarder = new PortForwarder('client');
const clientProxy = new ProxyServer('client');

tunnelServer.on('session', s => { serverForwarder.setSession(s); serverProxy.setSession(s); serverProxy.applyConfig(); });
tunnelClient.on('session', s => { clientForwarder.setSession(s); clientProxy.setSession(s); });

tunnelServer.start();
setTimeout(() => tunnelClient.start(), 500);

setTimeout(() => {
  console.log('--- Testing HTTP Proxy over Tunnel ---');
  const req = http.request({
    hostname: '127.0.0.1', port: 1121, path: 'www.baidu.com:80', method: 'CONNECT',
    headers: { 'Host': 'www.baidu.com:80' }
  });
  req.on('connect', (res, socket, head) => {
    console.log('[HTTP Proxy] Connected successfully, sending HTTP GET...');
    socket.write('GET / HTTP/1.1\r\nHost: www.baidu.com\r\nConnection: close\r\n\r\n');
    let recv = 0;
    socket.on('data', d => recv += d.length);
    socket.on('end', () => console.log(`[HTTP Proxy] Received ${recv} bytes from baidu.`));
  });
  req.on('error', e => console.error('[HTTP Proxy] Error:', e.message));
  req.end();
}, 2000);

setTimeout(() => {
  console.log('--- Testing SOCKS5 Proxy over Tunnel ---');
  const socket = net.connect(1121, '127.0.0.1', () => {
    socket.write(Buffer.from([0x05, 0x01, 0x00]));
    socket.once('data', d => {
      if (d[0] === 0x05 && d[1] === 0x00) {
        const host = Buffer.from('www.baidu.com');
        const req = Buffer.alloc(7 + host.length);
        req[0]=0x05; req[1]=0x01; req[2]=0x00; req[3]=0x03; req[4]=host.length;
        host.copy(req, 5);
        req.writeUInt16BE(80, 5 + host.length);
        socket.write(req);
        socket.once('data', d2 => {
          if (d2[0] === 0x05 && d2[1] === 0x00) {
            console.log('[SOCKS5 Proxy] Connected successfully, sending HTTP GET...');
            socket.write('GET / HTTP/1.1\r\nHost: www.baidu.com\r\nConnection: close\r\n\r\n');
            let recv = 0;
            socket.on('data', d3 => recv += d3.length);
            socket.on('end', () => {
              console.log(`[SOCKS5 Proxy] Received ${recv} bytes from baidu.`);
              process.exit(0);
            });
          }
        });
      }
    });
  });
  socket.on('error', e => console.error('[SOCKS5 Proxy] Error:', e.message));
}, 4000);
