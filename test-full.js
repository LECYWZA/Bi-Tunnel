const http = require('http');
const configManager = require('./src/config/config');
const tunnelServer = require('./src/core/tunnelServer');
const tunnelClient = require('./src/core/tunnelClient');
const PortForwarder = require('./src/core/portForwarder');
const ProxyServer = require('./src/core/proxyServer');

// Target server
http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Hello from target server');
}).listen(8083, () => console.log('Target server on 8083'));

// Config
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
      listenPort: 1114,
      listenIp: '127.0.0.1',
      useAuth: true,
      user: 'test',
      pass: 'test',
      useRemoteNetwork: true, // Use tunnel!
      allowIps: [],
      denyIps: [],
      targetAllowIps: [],
      targetDenyIps: []
    }]
  }
});

const serverForwarder = new PortForwarder('server');
const clientProxy = new ProxyServer('client');

tunnelServer.start();
tunnelServer.on('session', s => {
  serverForwarder.setSession(s);
  serverForwarder.applyConfig();
});

setTimeout(() => {
  tunnelClient.start();
  tunnelClient.on('session', s => {
    clientProxy.setSession(s);
    clientProxy.applyConfig();
    
    console.log("Testing proxy request...");
    const http = require('http');
    const options = {
      hostname: '127.0.0.1',
      port: 1114,
      path: 'cn.bing.com:443',
      method: 'CONNECT',
      headers: {
        'Proxy-Authorization': 'Basic ' + Buffer.from('test:test').toString('base64'),
        'Host': 'cn.bing.com:443'
      }
    };
    
    const req = http.request(options);
    req.on('connect', (res, socket, head) => {
      console.log('Proxy connected!');
      const tls = require('tls');
      const tlsSocket = tls.connect({
        socket: socket,
        servername: 'cn.bing.com'
      }, () => {
        console.log('TLS handshake successful');
        tlsSocket.write('GET / HTTP/1.1\r\nHost: cn.bing.com\r\nConnection: close\r\n\r\n');
      });
      tlsSocket.on('data', d => console.log('Response:', d.length));
      tlsSocket.on('error', e => console.log('TLS Error:', e.message));
    });
    req.on('error', e => {
      console.error('Proxy request error:', e);
      process.exit(1);
    });
    req.end();
  });
}, 1000);
