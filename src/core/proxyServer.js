const net = require('net');
const os = require('os');
const ipaddr = require('ipaddr.js');
const configManager = require('../config/config');
const { getLogger, logTraffic } = require('../utils/logger');
const Router = require('./router');
const ProxyDialer = require('./proxyDialer');
const trafficLogger = require('../utils/trafficLogger');

// A simple parser to sniff protocol
class ProxyServer {
  constructor(mode) {
    this.mode = mode;
    this.servers = new Map();
    this.sessions = new Map();
  }

  setSession(session, clientId) {
    this.sessions.set(clientId, session);
    
    // Listen for incoming channel requests from remote
    session.on('channel', (channel) => {
      const { meta } = channel;
      // Proxy server doesn't currently handle incoming forward requests targeting local, 
      // but if we ever add reverse proxy, it would go here.
    });
  }

  removeSession(clientId) {
    this.sessions.delete(clientId);
  }

  clearSessions() {
    this.sessions.clear();
  }

  applyConfig() {
    if (!this.mode || this.mode === 'none') return;
    const config = configManager.getConfig();
    const modeConfig = config[this.mode] || {};
    let desiredProxies = modeConfig.proxies || [];
    desiredProxies = desiredProxies.filter(p => p.enabled !== false);

    for (const [listenPort, server] of this.servers.entries()) {
      const p = desiredProxies.find(p => p.listenPort === listenPort);
      if (!p || server._bindHost !== (p.listenIp || '0.0.0.0')) {
        server.close();
        if (server._sockets) {
          for (const socket of server._sockets) {
            socket.destroy();
          }
        }
        this.servers.delete(listenPort);
        getLogger().info(`[Proxy] Stopped proxy on port ${listenPort}`);
      }
    }

    const startPromises = [];
    for (const p of desiredProxies) {
      if (!this.servers.has(p.listenPort)) {
        startPromises.push(this.startProxy(p.listenPort));
      }
    }
    return Promise.all(startPromises);
  }

  startProxy(listenPort) {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
        const currentConfig = configManager.getConfig()[this.mode]?.proxies.find(p => p.listenPort === listenPort);
        if (!currentConfig) {
          socket.destroy();
          return;
        }
        this.handleConnection(socket, currentConfig);
      });
      
      server._sockets = new Set();
      server.on('connection', (socket) => {
        server._sockets.add(socket);
        socket.on('close', () => {
          server._sockets.delete(socket);
        });
      });

      const currentConfig = configManager.getConfig()[this.mode]?.proxies.find(p => p.listenPort === listenPort);
      const bindHost = currentConfig?.listenIp || '0.0.0.0';

      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          reject({ code: 'PORT_IN_USE', port: listenPort });
        } else {
          getLogger().error(`[Proxy] Failed to listen on ${listenPort}: ${err.message}`);
          reject(err);
        }
      });

      server.listen(listenPort, bindHost, () => {
        getLogger().info(`[Proxy] Listening on ${bindHost}:${listenPort}`);
        server._bindHost = bindHost;
        this.servers.set(listenPort, server);
        resolve();
      });
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

  isLocalIp(ip) {
    if (!ip) return false;
    // Handle IPv4-mapped IPv6 addresses
    if (ip.startsWith('::ffff:')) {
      ip = ip.substring(7);
    }
    if (ip === '127.0.0.1' || ip === '::1') return true;

    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.address === ip) {
          return true;
        }
      }
    }
    return false;
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
    let requireAuth = proxyConfig.useAuth;
    const clientIp = socket.remoteAddress;
    
    // Auto-bypass auth for localhost / local machine interface IPs
    if (requireAuth && this.isLocalIp(clientIp)) {
      requireAuth = false;
    }

    if (requireAuth) {
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
      
      if (!proxyConfig.users) {
        proxyConfig.users = [{ user: String(proxyConfig.user || ''), pass: String(proxyConfig.pass || '') }];
      }
      
      const authenticated = proxyConfig.users.some(u => String(u.user) === user && String(u.pass) === pass);

      if (!authenticated) {
        getLogger().warn(`[Proxy] HTTP Auth failed. Got user: '${user}'`);
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.end();
        return;
      }
    }

    let method = match[1];
    let host = match[2];
    let port = parseInt(match[3]) || 80;

    // Use async wrapper to catch errors since handleHttp is synchronous in its callback flow
    (async () => {
      try {
        await this.processTarget(socket, host, port, proxyConfig, (channel) => {
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
      } catch (err) {
        getLogger().error(`[Proxy] Error processing target ${host}: ${err.message}`);
        socket.destroy();
      }
    })();
  }

  // SOCKS5 Handshake
  handleSocks5(socket, initialData, proxyConfig) {
    // 1. Auth selection
    let requireAuth = proxyConfig.useAuth;
    const clientIp = socket.remoteAddress;
    
    // Auto-bypass auth for localhost / local machine interface IPs
    if (requireAuth && this.isLocalIp(clientIp)) {
      requireAuth = false;
    }

    if (requireAuth) {
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
        
        if (!proxyConfig.users) {
          proxyConfig.users = [{ user: String(proxyConfig.user || ''), pass: String(proxyConfig.pass || '') }];
        }
        const authenticated = proxyConfig.users.some(u => String(u.user) === user && String(u.pass) === pass);

        if (authenticated) {
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
    socket.once('data', async (reqData) => {
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

      try {
        await this.processTarget(socket, host, port, proxyConfig, (channel) => {
          // Send SOCKS5 success reply
          const reply = Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
          socket.write(reply);
          socket.pipe(channel);
          channel.pipe(socket);
        });
      } catch (err) {
        getLogger().error(`[Proxy] Error processing SOCKS5 target ${host}: ${err.message}`);
        socket.destroy();
      }
    });
  }

  async processTarget(socket, host, port, proxyConfig, onConnected) {
    let actionResult = ['direct_local'];
    let rulePattern = '默认策略 (无规则)';

    // Helper to get fallback legacy action
    const getLegacyAction = () => {
      const isDirect = !proxyConfig.chainNodes || proxyConfig.chainNodes.length === 0;
      if (isDirect) {
        return [proxyConfig.useRemoteNetwork ? 'direct_remote' : 'direct_local'];
      }
      return ['proxy_chain'];
    };

    const globalConfig = configManager.getConfig();
    const resolvedRules = (proxyConfig.proxyRules || []).map(r => {
      const cardIds = r.ruleCardIds || (r.ruleCardId ? [r.ruleCardId] : []);
      const patterns = [];
      cardIds.forEach(id => {
        const card = (globalConfig.ruleCards || []).find(c => c.id === id);
        if (card && card.patterns) {
          patterns.push(...card.patterns);
        }
      });
      return {
        pattern: patterns,
        action: r.action
      };
    });

    // 默认兜底动作：空数组视为未设置，回退到 legacy 动作，避免静默拒绝所有未匹配流量
    const defaultAction = (Array.isArray(proxyConfig.defaultRuleAction) && proxyConfig.defaultRuleAction.length > 0)
      ? proxyConfig.defaultRuleAction
      : getLegacyAction();

    let targetIpForAcl = host;
    try {
       ipaddr.process(host); // Throws if not IP
       if (resolvedRules.length > 0) {
         const result = await Router.evaluate(host, resolvedRules, defaultAction);
         actionResult = result.action;
         rulePattern = result.rulePattern;
       } else {
         if (!this.checkAcl(targetIpForAcl, proxyConfig.targetAllowIps, proxyConfig.targetDenyIps)) {
           actionResult = ['block'];
           rulePattern = 'ACL 拒绝';
         } else {
           actionResult = defaultAction;
         }
       }
    } catch(e) {
       if (resolvedRules.length > 0) {
         const result = await Router.evaluate(host, resolvedRules, defaultAction);
         actionResult = result.action;
         rulePattern = result.rulePattern;
       } else {
         actionResult = defaultAction;
       }
    }

    let actions = Array.isArray(actionResult) ? actionResult : [actionResult];

    // 空动作列表直接拒绝（防御性检查，正常情况下 defaultAction 已保证非空）
    // block 不再在此特判，统一交给下方故障切换循环处理，使 block 在任意位置都能正确生效
    if (actions.length === 0) {
      getLogger().warn(`[Proxy] Denied access to ${host} due to empty action list`);
      socket.destroy();
      return;
    }

    let targetSession = null;
    let resolvedClientId = '';
    if (this.mode === 'server') {
      const clientId = proxyConfig.targetClientId || 'client-1';
      targetSession = this.sessions.get(clientId);
      if (targetSession) {
        resolvedClientId = clientId;
      } else if (this.sessions.size === 1) {
        resolvedClientId = this.sessions.keys().next().value;
        targetSession = this.sessions.values().next().value;
      }
    } else {
      const serverConnId = proxyConfig.targetClientId || 'default';
      targetSession = this.sessions.get(serverConnId);
      if (targetSession) {
        resolvedClientId = serverConnId;
      } else if (this.sessions.size === 1) {
        resolvedClientId = this.sessions.keys().next().value;
        targetSession = this.sessions.values().next().value;
      }
    }

    const tryAction = (action) => {
      return new Promise((resolve, reject) => {
        if (action === 'block') {
          // block 视为必然失败的动作，参与故障切换：前面动作成功则不会触达，全部失败则拒绝
          return reject(new Error('Blocked by routing rule'));
        }
        if (action === 'proxy_chain') {
          const globalConfig = configManager.getConfig();
          const resolvedNodes = (proxyConfig.chainNodes || []).map(ref => globalConfig.proxyNodes?.find(n => n.id === ref)).filter(Boolean);
          if (resolvedNodes.length === 0) return reject(new Error('Proxy chain is empty or has no valid resolved nodes'));
          ProxyDialer.dialChain(resolvedNodes, host, port, proxyConfig.useRemoteNetwork, targetSession, (err, finalSocket) => {
            if (err) return reject(err);
            resolve(finalSocket);
          });
        } else if (action.startsWith('chain:')) {
          const chainId = action.substring(6);
          const globalConfig = configManager.getConfig();
          const chain = globalConfig.proxyChains?.find(c => c.id === chainId);
          if (!chain || !chain.nodes || chain.nodes.length === 0) return reject(new Error(`Proxy chain ${chainId} not found or empty`));
          
          const resolvedNodes = chain.nodes.map(ref => globalConfig.proxyNodes?.find(n => n.id === ref)).filter(Boolean);
          if (resolvedNodes.length === 0) return reject(new Error(`Proxy chain ${chainId} has no valid resolved nodes`));
          
          ProxyDialer.dialChain(resolvedNodes, host, port, proxyConfig.useRemoteNetwork, targetSession, (err, finalSocket) => {
            if (err) return reject(err);
            resolve(finalSocket);
          });
        } else if (action.startsWith('node:')) {
          const nodeId = action.substring(5);
          const globalConfig = configManager.getConfig();
          const node = globalConfig.proxyNodes?.find(n => n.id === nodeId);
          if (!node) return reject(new Error(`Proxy node ${nodeId} not found`));
          
          ProxyDialer.dialChain([node], host, port, proxyConfig.useRemoteNetwork, targetSession, (err, finalSocket) => {
            if (err) return reject(err);
            resolve(finalSocket);
          });
        } else if (action === 'direct_remote') {
          if (!targetSession) return reject(new Error(`direct_remote failed: targetSession not found`));
          const channel = targetSession.createChannel({ type: 'forward', host: host, port: port });
          let resolved = false;
          channel.once('error', (err) => {
            if (!resolved) { resolved = true; reject(err); }
          });
          setTimeout(() => {
             if (!resolved) { resolved = true; resolve(channel); }
          }, 100);
        } else {
          const outbound = new net.Socket();
          let resolved = false;
          outbound.connect(port, host, () => {
            if (!resolved) { resolved = true; resolve(outbound); }
          });
          outbound.once('error', (err) => {
            if (!resolved) { resolved = true; reject(err); }
          });
        }
      });
    };

    const buildRoutePath = (action, target) => {
      const path = ['本机'];
      const globalConfig = configManager.getConfig();
      
      if (action.startsWith('chain:')) {
        const chainId = action.substring(6);
        const chain = globalConfig.proxyChains?.find(c => c.id === chainId);
        if (chain && chain.nodes) {
          for (const ref of chain.nodes) {
            const node = globalConfig.proxyNodes?.find(n => n.id === ref);
            path.push(node ? (node.displayName || node.name || node.host) : ref);
          }
        } else {
          path.push(`链:${chainId}`);
        }
      } else if (action.startsWith('node:')) {
        const nodeId = action.substring(5);
        const node = globalConfig.proxyNodes?.find(n => n.id === nodeId);
        path.push(node ? (node.displayName || node.name || node.host) : nodeId);
      } else if (action === 'proxy_chain') {
        const resolvedNodes = (proxyConfig.chainNodes || []).map(ref => globalConfig.proxyNodes?.find(n => n.id === ref)).filter(Boolean);
        if (resolvedNodes.length > 0) {
          for (const node of resolvedNodes) {
            path.push(node.displayName || node.name || node.host);
          }
        } else {
          path.push('代理链');
        }
      } else if (action === 'direct_remote') {
        path.push('隧道');
      } else if (action === 'direct' || action === 'direct_local') {
        path.push('直连');
      } else if (action === 'block') {
        return ['本机', '拦截', target];
      } else {
        path.push(action);
      }
      
      path.push(target);
      return path;
    };

    const getModuleName = (listenPort) => {
      const config = configManager.getConfig();
      // 以代理唯一 ID 作为区分依据，兼容旧的 activeProxyPort
      let isActive = false;
      if (config.activeProxyId) {
        const modeProxies = (this.mode === 'server' ? config.server?.proxies : config.client?.proxies) || [];
        const proxy = modeProxies.find(p => p.listenPort === listenPort);
        isActive = proxy ? (proxy.id === config.activeProxyId) : (listenPort === config.activeProxyPort);
      } else {
        isActive = listenPort === config.activeProxyPort;
      }
      if (isActive) {
        if (config.tunModeEnabled) {
          return `虚拟网卡代理 (${this.mode === 'server' ? '服务端' : '客户端'})`;
        }
        if (config.globalProxyEnabled) {
          return `系统代理 (${this.mode === 'server' ? '服务端' : '客户端'})`;
        }
      }
      return `混合代理 (${this.mode === 'server' ? '服务端' : '客户端'})`;
    };

    let successfulAction = null;
    let finalSocket = null;
    const startTime = Date.now();

    for (const action of actions) {
      try {
        finalSocket = await tryAction(action);
        successfulAction = action;
        break;
      } catch (err) {
        getLogger().warn(`[Proxy] Action ${action} to ${host}:${port} failed: ${err.message}. Trying next...`);
      }
    }

    if (!finalSocket) {
      getLogger().error(`[Proxy] All actions failed for ${host}:${port}`);
      socket.destroy();
      
      // Log connection failure
      trafficLogger.addLog({
        module: getModuleName(proxyConfig.listenPort),
        sourceIp: socket.remoteAddress,
        target: `${host}:${port}`,
        action: actions.join(', '),
        rulePattern: rulePattern,
        bytesTransferred: socket.bytesRead + socket.bytesWritten,
        durationMs: Date.now() - startTime,
        status: 'failed',
        error: '所有转发动作均失败',
        clientId: resolvedClientId,
        routePath: ['本机', '失败', `${host}:${port}`]
      });
      return;
    }

    getLogger().info(`[Proxy] Routing ${host}:${port} via ${successfulAction} (Rule: ${rulePattern})`);
    
    // Add early log entry
    const logEntry = trafficLogger.addLog({
      module: getModuleName(proxyConfig.listenPort),
      sourceIp: socket.remoteAddress,
      target: `${host}:${port}`,
      action: successfulAction,
      rulePattern: rulePattern,
      bytesTransferred: 0,
      durationMs: 0,
      status: 'active',
      clientId: resolvedClientId,
      routePath: buildRoutePath(successfulAction, `${host}:${port}`)
    });
    
    socket.on('close', () => {
      const bytes = socket.bytesRead + socket.bytesWritten;
      logTraffic('Proxy', `to ${host}:${port} (${successfulAction})`, bytes);
      if (logEntry) {
        logEntry.bytesTransferred = bytes;
        logEntry.durationMs = Date.now() - startTime;
        logEntry.status = 'success';
        trafficLogger.updateLog(logEntry);
      }
    });

    finalSocket.on('error', () => socket.destroy());
    socket.on('error', () => finalSocket.destroy());
    onConnected(finalSocket);
  }
}

module.exports = ProxyServer;
