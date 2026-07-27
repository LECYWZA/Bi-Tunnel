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
        startPromises.push(this.startProxy(p.listenPort).catch(err => {
          // 单个代理启动失败不应阻断其他代理:记录错误并继续
          if (err && err.code === 'PORT_IN_USE') {
            getLogger().error(`[Proxy] 端口 ${err.port} 已被占用,该代理启动失败,其他代理不受影响`);
          } else {
            getLogger().error(`[Proxy] 代理启动失败 (端口 ${p.listenPort}): ${err && err.message ? err.message : JSON.stringify(err)}`);
          }
          return { failed: true, port: p.listenPort, err };
        }));
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

      const errorHandler = (err) => {
        if (err.code === 'EADDRINUSE') {
          reject({ code: 'PORT_IN_USE', port: listenPort });
        } else {
          getLogger().error(`[Proxy] Failed to listen on ${listenPort}: ${err.message}`);
          reject(err);
        }
      };
      server.once('error', errorHandler);

      server.listen(listenPort, bindHost, () => {
        server.removeListener('error', errorHandler);
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

    if (host.startsWith('[') && host.endsWith(']')) {
      host = host.slice(1, -1);
    }

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
          const leftover = authData.slice(3 + ulen + plen);
          this.readSocks5Request(socket, proxyConfig, leftover);
        } else {
          socket.write(Buffer.from([0x01, 0x01])); // Failure
          socket.destroy();
        }
      });
    } else {
      socket.write(Buffer.from([0x05, 0x00])); // NO AUTH REQUIRED
      const nmethods = initialData[1] || 1;
      const leftover = initialData.slice(2 + nmethods);
      this.readSocks5Request(socket, proxyConfig, leftover);
    }
  }

  readSocks5Request(socket, proxyConfig, initialLeftover = Buffer.alloc(0)) {
    if (!socket._socksBuffer) socket._socksBuffer = Buffer.alloc(0);
    if (initialLeftover && initialLeftover.length > 0) {
      socket._socksBuffer = Buffer.concat([socket._socksBuffer, initialLeftover]);
    }

    const onData = async (chunk) => {
      if (chunk && chunk.length > 0) {
        socket._socksBuffer = Buffer.concat([socket._socksBuffer, chunk]);
      }
      const buf = socket._socksBuffer;
      if (buf.length < 4) return; // Wait for VER, CMD, RSV, ATYP

      if (buf[0] !== 0x05 || buf[1] !== 0x01) { // 0x05 = SOCKS5, 0x01 = CONNECT
        socket.removeListener('data', onData);
        socket.destroy();
        return;
      }

      const atyp = buf[3];
      let reqLen = 0;
      let host = '';
      let port = 0;
      let offset = 4;

      if (atyp === 0x01) { // IPv4
        reqLen = 4 + 4 + 2; // 10 bytes
        if (buf.length < reqLen) return;
        host = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`;
        offset += 4;
      } else if (atyp === 0x03) { // Domain
        if (buf.length < 5) return;
        const len = buf[4];
        reqLen = 5 + len + 2;
        if (buf.length < reqLen) return;
        host = buf.slice(5, 5 + len).toString('utf8');
        offset += 1 + len;
      } else if (atyp === 0x04) { // IPv6
        reqLen = 4 + 16 + 2; // 22 bytes
        if (buf.length < reqLen) return;
        const parts = [];
        for (let i = 0; i < 16; i += 2) {
          parts.push(buf.readUInt16BE(4 + i).toString(16));
        }
        host = parts.join(':');
        offset += 16;
      } else {
        socket.removeListener('data', onData);
        socket.destroy();
        return;
      }

      port = buf.readUInt16BE(offset);
      socket.removeListener('data', onData);

      const leftover = buf.slice(reqLen);
      try {
        await this.processTarget(socket, host, port, proxyConfig, (channel) => {
          // Send SOCKS5 success reply
          const reply = Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
          socket.write(reply);
          if (leftover.length > 0) {
            channel.write(leftover);
          }
          socket.pipe(channel);
          channel.pipe(socket);
        });
      } catch (err) {
        getLogger().error(`[Proxy] Error processing SOCKS5 target ${host}: ${err.message}`);
        socket.destroy();
      }
    };

    socket.on('data', onData);
    if (socket._socksBuffer.length > 0) {
      process.nextTick(() => {
        if (!socket.destroyed) onData(Buffer.alloc(0));
      });
    }
  }

  async processTarget(socket, host, port, proxyConfig, onConnected) {
    let actionResult = ['direct_local'];
    let rulePattern = '默认策略 (无规则)';
    let effectiveNetworkMode = 'local';
    let effectiveTargetClientId = '';

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
        action: r.action,
        networkMode: r.networkMode || 'local',
        targetClientId: r.targetClientId || ''
      };
    });

    // 默认兜底动作:新格式 defaultRuleActions (对象数组),旧格式 defaultRuleAction (字符串数组)兼容
    const defaultActionItems = Array.isArray(proxyConfig.defaultRuleActions) && proxyConfig.defaultRuleActions.length > 0
      ? proxyConfig.defaultRuleActions
      : null;
    const defaultAction = defaultActionItems
      ? defaultActionItems.map(it => it.action)
      : ['direct_local'];

    let matchedRule = null;

    // 1. 评估路由规则 (host 为 IP 或域名均可)
    if (resolvedRules.length > 0) {
      const result = await Router.evaluate(host, resolvedRules, defaultAction);
      actionResult = result.action;
      rulePattern = result.rulePattern;
      matchedRule = result.matchedRule;
    } else {
      actionResult = defaultAction;
    }

    // 2. 目标 ACL 校验 (独立于规则,仅当目标为 IP 地址时生效)
    if (proxyConfig.targetAllowIps?.length || proxyConfig.targetDenyIps?.length) {
      let targetIp = null;
      try {
        ipaddr.process(host); // 是 IP 则不抛异常
        targetIp = host;
      } catch (e) {
        // host 是域名,无法做 IP 级 ACL 检查,跳过
      }
      if (targetIp && !this.checkAcl(targetIp, proxyConfig.targetAllowIps, proxyConfig.targetDenyIps)) {
        actionResult = ['block'];
        rulePattern = 'ACL 拒绝';
        matchedRule = null;
      }
    }

    // 当 ACL 阻止且无 defaultActionItems 时,确保 actionItems 后续能正确构造
    // (后续逻辑中,matchedRule===null 且 defaultActionItems 存在时会走默认动作项,
    //  但 ACL 已设为 block,需保证不会重复构建默认动作)

    // 确定本条请求的网络模式与目标服务
    // 命中规则:用规则级的 networkMode/targetClientId
    // 未命中(走默认动作):用第一个默认动作项的 networkMode/targetClientId
    if (matchedRule) {
      effectiveNetworkMode = matchedRule.networkMode || 'local';
      effectiveTargetClientId = matchedRule.targetClientId || '';
    } else if (defaultActionItems && defaultActionItems.length > 0) {
      effectiveNetworkMode = defaultActionItems[0].networkMode || 'local';
      effectiveTargetClientId = defaultActionItems[0].targetClientId || '';
    }

    let actions = Array.isArray(actionResult) ? actionResult : [actionResult];

    // 空动作列表直接拒绝(防御性检查,正常情况下 defaultAction 已保证非空)
    // block 不再在此特判,统一交给下方故障切换循环处理,使 block 在任意位置都能正确生效
    if (actions.length === 0) {
      getLogger().warn(`[Proxy] Denied access to ${host} due to empty action list`);
      socket.destroy();
      return;
    }

    // 解析 targetSession:根据 networkMode 和 targetClientId 查找会话
    const resolveSession = (networkMode, targetClientId) => {
      if (networkMode !== 'remote') return { session: null, clientId: '' };
      if (this.mode === 'server') {
        const clientId = targetClientId || 'client-1';
        let session = this.sessions.get(clientId);
        let resolvedId = clientId;
        if (!session && this.sessions.size === 1) {
          resolvedId = this.sessions.keys().next().value;
          session = this.sessions.values().next().value;
        }
        return { session, clientId: resolvedId };
      } else {
        const serverConnId = targetClientId || 'default';
        let session = this.sessions.get(serverConnId);
        let resolvedId = serverConnId;
        if (!session && this.sessions.size === 1) {
          resolvedId = this.sessions.keys().next().value;
          session = this.sessions.values().next().value;
        }
        return { session, clientId: resolvedId };
      }
    };

    // 构建带元数据的动作列表:命中规则时所有动作共用规则的网络模式;默认动作时每项用自己的
    // actionItems: [{ action, networkMode, targetClientId }]
    let actionItems;
    if (matchedRule) {
      actionItems = actions.map(a => ({ action: a, networkMode: effectiveNetworkMode, targetClientId: effectiveTargetClientId }));
    } else if (defaultActionItems && defaultActionItems.length > 0) {
      // 默认动作:每项带自己的网络模式(动作顺序与 defaultActionItems 一致)
      actionItems = defaultActionItems.map(it => ({ action: it.action, networkMode: it.networkMode || 'local', targetClientId: it.targetClientId || '' }));
      // 但 actionResult 可能被 ACL 改成 ['block'],此时只取 block
      if (actions.length === 1 && actions[0] === 'block') {
        actionItems = [{ action: 'block', networkMode: 'local', targetClientId: '' }];
      }
    } else {
      actionItems = actions.map(a => ({ action: a, networkMode: effectiveNetworkMode, targetClientId: effectiveTargetClientId }));
    }

    // 预解析首个 remote 动作的 clientId，供后续故障切换循环作为初始值
    let resolvedClientId = '';
    const firstItem = actionItems[0] || { networkMode: 'local', targetClientId: '' };
    if (firstItem.networkMode === 'remote') {
      const s = resolveSession(firstItem.networkMode, firstItem.targetClientId);
      resolvedClientId = s.clientId;
    }

    const tryAction = (action, useRemote, session) => {
      return new Promise((resolve, reject) => {
        if (action === 'block') {
          // block 视为必然失败的动作，参与故障切换：前面动作成功则不会触达，全部失败则拒绝
          return reject(new Error('Blocked by routing rule'));
        }
        if (action === 'proxy_chain') {
          const globalConfig = configManager.getConfig();
          const resolvedNodes = (proxyConfig.chainNodes || []).map(ref => globalConfig.proxyNodes?.find(n => n.id === ref)).filter(Boolean);
          if (resolvedNodes.length === 0) return reject(new Error('Proxy chain is empty or has no valid resolved nodes'));
          ProxyDialer.dialChain(resolvedNodes, host, port, useRemote, session, (err, finalSocket) => {
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

          ProxyDialer.dialChain(resolvedNodes, host, port, useRemote, session, (err, finalSocket) => {
            if (err) return reject(err);
            resolve(finalSocket);
          });
        } else if (action.startsWith('node:')) {
          const nodeId = action.substring(5);
          const globalConfig = configManager.getConfig();
          const node = globalConfig.proxyNodes?.find(n => n.id === nodeId);
          if (!node) return reject(new Error(`Proxy node ${nodeId} not found`));

          ProxyDialer.dialChain([node], host, port, useRemote, session, (err, finalSocket) => {
            if (err) return reject(err);
            resolve(finalSocket);
          });
        } else if (action === 'direct_remote') {
          if (!session) return reject(new Error(`direct_remote failed: targetSession not found`));
          const channel = session.createChannel({ type: 'forward', host: host, port: port });
          let resolved = false;
          const timer = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              getLogger().warn(`[Proxy] No ACK from remote for ${host}:${port}, proceeding anyway (timeout)`);
              resolve(channel);
            }
          }, 5000);
          channel.once('ack', (success) => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timer);
            if (success) {
              resolve(channel);
            } else {
              reject(new Error(`Remote target ${host}:${port} unreachable`));
            }
          });
          channel.once('error', (err) => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timer);
            reject(err);
          });
        } else {
          const outbound = new net.Socket();
          let resolved = false;
          outbound.connect(port, host, () => {
            if (!resolved) { resolved = true; resolve(outbound); }
          });
          outbound.once('error', (err) => {
            if (!resolved) {
              resolved = true;
              try { outbound.destroy(); } catch (e) {}
              reject(err);
            }
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

    for (const item of actionItems) {
      // 每项动作按自己的网络模式解析 session
      // direct_remote 强制解析 session（兼容旧数据中 networkMode 为 local 的情况）
      let itemSession = null;
      let itemClientId = resolvedClientId;
      if (item.networkMode === 'remote' || item.action === 'direct_remote') {
        const s = resolveSession(item.networkMode, item.targetClientId);
        itemSession = s.session;
        itemClientId = s.clientId;
        if (successfulAction === null) {
          // 首次 remote 项,记录其 clientId 用于日志
          resolvedClientId = itemClientId;
        }
      }
      try {
        finalSocket = await tryAction(item.action, item.networkMode === 'remote', itemSession);
        successfulAction = item.action;
        resolvedClientId = itemClientId;
        break;
      } catch (err) {
        getLogger().warn(`[Proxy] Action ${item.action} to ${host}:${port} failed: ${err.message}. Trying next...`);
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

    if (socket.destroyed || socket.closed) {
      finalSocket.destroy();
      return;
    }

    finalSocket.on('error', () => socket.destroy());
    socket.on('error', () => finalSocket.destroy());
    onConnected(finalSocket);
  }
}

module.exports = ProxyServer;
