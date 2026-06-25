const net = require('net');
const ipaddr = require('ipaddr.js');
const configManager = require('../config/config');
const { getLogger, logTraffic } = require('../utils/logger');

// A simple parser to sniff protocol
class ProxyServer {
  constructor(mode) {
    this.mode = mode;
    this.servers = new Map();
    this.currentSession = null;
  }

  setSession(session) {
    this.currentSession = session;
    if (!session) return;
    
    // Listen for incoming channel requests from remote
    session.on('channel', (channel) => {
      const { meta } = channel;
      // Proxy server doesn't currently handle incoming forward requests targeting local, 
      // but if we ever add reverse proxy, it would go here.
    });
  }

  applyConfig() {
    if (!this.mode || this.mode === 'none') return;
    const config = configManager.getConfig();
    const modeConfig = config[this.mode] || {};
    const desiredProxies = modeConfig.proxies || [];

    for (const [listenPort, server] of this.servers.entries()) {
      const p = desiredProxies.find(p => p.listenPort === listenPort);
      if (!p || server._bindHost !== (p.listenIp || '0.0.0.0')) {
        server.close();
        this.servers.delete(listenPort);
        getLogger().info(`[Proxy] Stopped proxy on port ${listenPort}`);
      }
    }

    for (const p of desiredProxies) {
      if (!this.servers.has(p.listenPort)) {
        this.startProxy(p.listenPort);
      }
    }
  }

  startProxy(listenPort) {
    const server = net.createServer((socket) => {
      const currentConfig = configManager.getConfig()[this.mode]?.proxies.find(p => p.listenPort === listenPort);
      if (!currentConfig) {
        socket.destroy();
        return;
      }
      this.handleConnection(socket, currentConfig);
    });

    const currentConfig = configManager.getConfig()[this.mode]?.proxies.find(p => p.listenPort === listenPort);
    const bindHost = currentConfig?.listenIp || '0.0.0.0';

    server.listen(listenPort, bindHost, () => {
      getLogger().info(`[Proxy] Listening on ${bindHost}:${listenPort}`);
      server._bindHost = bindHost;
      this.servers.set(listenPort, server);
    });

    server.on('error', (err) => {
      getLogger().error(`[Proxy] Failed to listen on ${listenPort}: ${err.message}`);
    });
  }

  checkAcl(ip, allowedList, deniedList) {
    if (!ip) return false;
    let parsedIp;
    try {
      parsedIp = ipaddr.process(ip);
    } catch(e) { return false; } // Invalid IP

    // Deny list takes precedence
    if (deniedList && deniedList.length > 0) {
      for (const cidr of deniedList) {
        if (this.matchCidr(parsedIp, cidr)) return false;
      }
    }
    
    // If allow list is present, it must match
    if (allowedList && allowedList.length > 0) {
      let matched = false;
      for (const cidr of allowedList) {
        if (this.matchCidr(parsedIp, cidr)) {
          matched = true;
          break;
        }
      }
      if (!matched) return false;
    }

    return true;
  }

  matchCidr(parsedIp, cidrStr) {
    try {
      if (cidrStr.indexOf('/') === -1) {
        // Single IP
        return parsedIp.toString() === ipaddr.process(cidrStr).toString();
      }
      const range = ipaddr.parseCIDR(cidrStr);
      return parsedIp.match(range);
    } catch (e) {
      return false; // Ignore bad CIDR formats
    }
  }

  handleConnection(socket, proxyConfig) {
    const clientIp = socket.remoteAddress;
    
    // 1. Source IP ACL
    if (!this.checkAcl(clientIp, proxyConfig.allowIps, proxyConfig.denyIps)) {
      getLogger().warn(`[Proxy] Denied connection from ${clientIp} due to source ACL`);
      socket.destroy();
      return;
    }
    
    getLogger().info(`[Proxy] Accepted connection from ${clientIp} on port ${proxyConfig.listenPort}`);

    // Sniff protocol (SOCKS5 or HTTP)
    socket.once('data', (data) => {
      if (data[0] === 0x05) {
        this.handleSocks5(socket, data, proxyConfig);
      } else {
        this.handleHttp(socket, data, proxyConfig);
      }
    });
  }

  // Very basic HTTP Proxy implementation (CONNECT method mostly)
  handleHttp(socket, dataChunk, proxyConfig) {
    if (!socket._httpBuffer) socket._httpBuffer = Buffer.alloc(0);
    socket._httpBuffer = Buffer.concat([socket._httpBuffer, dataChunk]);

    const headerEndIdx = socket._httpBuffer.indexOf('\r\n\r\n');
    if (headerEndIdx === -1) {
      // Headers not fully received yet, wait for more data
      // To prevent infinite buffering attacks, we can add a limit
      if (socket._httpBuffer.length > 8192) {
        socket.destroy();
        return;
      }
      socket.once('data', (d) => this.handleHttp(socket, d, proxyConfig));
      return;
    }

    const fullHeaders = socket._httpBuffer;
    let leftover = Buffer.alloc(0);
    if (headerEndIdx + 4 < fullHeaders.length) {
      leftover = fullHeaders.slice(headerEndIdx + 4);
    }

    const reqStr = fullHeaders.toString('utf8', 0, headerEndIdx);
    const lines = reqStr.split('\r\n');
    const firstLine = lines[0];
    const match = firstLine.match(/^(CONNECT) ([^:]+):(\d+) HTTP\//) || firstLine.match(/^(GET|POST|PUT|DELETE|HEAD|OPTIONS) http:\/\/([^/:]+)(?::(\d+))?/);
    
    if (!match) {
      socket.destroy();
      return;
    }

    // Auth check
    if (proxyConfig.useAuth) {
      const authHeader = lines.find(l => l.toLowerCase().startsWith('proxy-authorization:'));
      if (!authHeader) {
        socket.write('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Proxy"\r\n\r\n');
        socket.end();
        return;
      }
      const matchAuth = authHeader.match(/basic\s+([a-zA-Z0-9+/=]+)/i);
      if (!matchAuth) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.end();
        return;
      }
      const b64 = matchAuth[1];
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      const [user, ...passParts] = decoded.split(':');
      const pass = passParts.join(':'); // In case password contains ':'
      if (user !== String(proxyConfig.user) || pass !== String(proxyConfig.pass)) {
        getLogger().warn(`[Proxy] HTTP Auth failed. Expected: '${proxyConfig.user}':'${proxyConfig.pass}', Got: '${user}':'${pass}', Header: ${authHeader}, b64: ${b64}, decoded: ${decoded}`);
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.end();
        return;
      }
    }

    let method = match[1];
    let host = match[2];
    let port = parseInt(match[3]) || 80;

    this.processTarget(socket, host, port, proxyConfig, (channel) => {
      if (method === 'CONNECT') {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (leftover.length > 0) {
          channel.write(leftover);
        }
        socket.pipe(channel);
        channel.pipe(socket);
      } else {
        // Transparently pipe the initial GET/POST request over the channel
        channel.write(fullHeaders);
        socket.pipe(channel);
        channel.pipe(socket);
      }
    });
  }

  // SOCKS5 Handshake
  handleSocks5(socket, initialData, proxyConfig) {
    // 1. Auth selection
    if (proxyConfig.useAuth) {
      // Require Username/Password (0x02)
      if (!initialData.includes(0x02, 2)) { // Methods are from byte 2 onwards
        socket.write(Buffer.from([0x05, 0xFF])); // No acceptable auth methods
        socket.destroy();
        return;
      }
      socket.write(Buffer.from([0x05, 0x02]));
      
      socket.once('data', (authData) => {
        if (authData[0] !== 0x01) { socket.destroy(); return; } // Version 1 of subnegotiation
        const ulen = authData[1];
        const user = authData.slice(2, 2 + ulen).toString('utf8');
        const plen = authData[2 + ulen];
        const pass = authData.slice(3 + ulen, 3 + ulen + plen).toString('utf8');
        
        if (user === proxyConfig.user && pass === proxyConfig.pass) {
          socket.write(Buffer.from([0x01, 0x00])); // Success
          this.readSocks5Request(socket, proxyConfig);
        } else {
          socket.write(Buffer.from([0x01, 0x01])); // Failure
          socket.destroy();
        }
      });
    } else {
      socket.write(Buffer.from([0x05, 0x00])); // NO AUTH REQUIRED
      this.readSocks5Request(socket, proxyConfig);
    }
  }

  readSocks5Request(socket, proxyConfig) {
    socket.once('data', (reqData) => {
      if (reqData.length < 10 || reqData[0] !== 0x05 || reqData[1] !== 0x01) {
        socket.destroy();
        return;
      }
      const atyp = reqData[3];
      let host = '';
      let port = 0;
      let offset = 4;

      if (atyp === 0x01) { // IPv4
        host = `${reqData[4]}.${reqData[5]}.${reqData[6]}.${reqData[7]}`;
        offset += 4;
      } else if (atyp === 0x03) { // Domain
        const len = reqData[4];
        host = reqData.slice(5, 5 + len).toString('utf8');
        offset += 1 + len;
      } else if (atyp === 0x04) { // IPv6
        // Simplified IPv6 ignoring for now, rarely used natively here
        socket.destroy();
        return;
      }
      
      port = reqData.readUInt16BE(offset);

      this.processTarget(socket, host, port, proxyConfig, (channel) => {
        // Send SOCKS5 success reply
        const reply = Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
        socket.write(reply);
        socket.pipe(channel);
        channel.pipe(socket);
      });
    });
  }

  processTarget(socket, host, port, proxyConfig, onConnected) {
    // We should resolve DNS to check target IP ACL
    // For simplicity, if it's a domain, we might skip target IP ACL if not possible locally
    // If it's an IP, we can check it.
    let targetIpForAcl = host;
    try {
       // if it parses, it's an IP
       ipaddr.process(host);
        if (!this.checkAcl(targetIpForAcl, proxyConfig.targetAllowIps, proxyConfig.targetDenyIps)) {
          getLogger().warn(`[Proxy] Denied access to ${host} due to target ACL`);
          socket.destroy();
          return;
       }
    } catch(e) {
       // It's a domain. If there are strict target ACLs, we should technically resolve it.
       // We'll skip domain target ACL for brevity unless explicitly implementing a resolver.
    }
    
    getLogger().info(`[Proxy] Proxying traffic to ${host}:${port} (${proxyConfig.useRemoteNetwork ? 'remote' : 'local'} network)`);
    socket.on('close', () => {
      logTraffic('Proxy', `to ${host}:${port} (${proxyConfig.useRemoteNetwork ? 'remote' : 'local'})`, socket.bytesRead + socket.bytesWritten);
    });

    if (proxyConfig.useRemoteNetwork) {
      if (!this.currentSession) {
        socket.destroy();
        return;
      }
      // Create channel to remote
      const channel = this.currentSession.createChannel({
        type: 'forward',
        host: host,
        port: port
      });
      channel.on('error', () => socket.destroy());
      socket.on('error', () => channel.end());
      
      onConnected(channel);
    } else {
      // Local network
      const outbound = new net.Socket();
      outbound.connect(port, host, () => {
        onConnected(outbound);
      });
      outbound.on('error', () => socket.destroy());
      socket.on('error', () => outbound.destroy());
    }
  }
}

module.exports = ProxyServer;
