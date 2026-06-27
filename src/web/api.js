const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');
const net = require('net');
const tls = require('tls');
const dns = require('dns');
const fs = require('fs');
const os = require('os');
const { URL } = require('url');
const crypto = require('crypto');
const configManager = require('../config/config');
const { getLogger } = require('../utils/logger');
const trafficLogger = require('../utils/trafficLogger');
const { getCertificates } = require('../utils/tlsGenerator');
const { enableSystemProxy, disableSystemProxy } = require('../utils/systemProxy');
const ProxyDialer = require('../core/proxyDialer');

// Dependency Injection to get current status
let getStatus = () => ({});

let currentAuthToken = '';

function createWebServer(statusCallback) {
  const config = configManager.getConfig();
  if (!config.secretToken) {
    config.secretToken = crypto.randomBytes(16).toString('hex');
    configManager.saveConfig(config);
  }
  currentAuthToken = config.secretToken;

  getStatus = statusCallback || (() => ({}));
  const app = express();
  
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  app.use((req, res, next) => {
    // allow static files and login endpoints
    if (req.path === '/api/login' || !req.path.startsWith('/api/')) {
      return next();
    }
    
    const cookies = req.headers.cookie || '';
    const token = cookies.split('; ').find(row => row.startsWith('bt_token='))?.split('=')[1];
    
    if (token && token === currentAuthToken) {
      return next();
    } else {
      res.status(401).json({ error: 'Unauthorized', message: 'Not logged in' });
    }
  });

  app.post('/api/login', (req, res) => {
    const config = configManager.getConfig();
    const validUser = config.webUsername || 'admin';
    const validPass = config.webPassword || 'password';
    
    if (req.body.username === validUser && req.body.password === validPass) {
      res.cookie('bt_token', currentAuthToken, { httpOnly: true, sameSite: 'strict', maxAge: 24 * 60 * 60 * 1000 });
      res.json({ success: true });
    } else {
      res.status(401).json({ success: false, message: '账号或密码错误' });
    }
  });

  app.post('/api/logout', (req, res) => {
    res.clearCookie('bt_token');
    res.json({ success: true });
  });

  app.get('/api/config', (req, res) => {
    const config = configManager.getConfig();
    const tunnelServer = require('../core/tunnelServer');
    if (config.server && config.server.knownClients) {
      config.server.knownClients.forEach(c => {
        c.online = tunnelServer.sessions ? tunnelServer.sessions.has(c.id) : false;
      });
    }
    config.web = {
      httpPort: configManager.getConfig().webHttpPort || 8898,
      httpsPort: configManager.getConfig().webPort || 8899,
      protocol: configManager.getConfig().webProtocol || 'https'
    };
    res.json(config);
  });

  app.post('/api/config', (req, res) => {
    const tunnelServer = require('../core/tunnelServer');
    const currentConfig = configManager.getConfig();
    
    if (req.body.server && req.body.server.knownClients) {
      req.body.server.knownClients.forEach(incoming => {
        // Calculate live online status
        incoming.online = tunnelServer.sessions ? tunnelServer.sessions.has(incoming.id) : false;
        
        // Merge and preserve server-managed runtime statistics
        if (currentConfig.server && currentConfig.server.knownClients) {
          const live = currentConfig.server.knownClients.find(c => c.id === incoming.id);
          if (live) {
            incoming.firstSeen = live.firstSeen;
            incoming.lastConnected = live.lastConnected;
            incoming.totalDuration = live.totalDuration;
          }
        }
      });
    }
    
    configManager.saveConfig(req.body);
    getLogger().info('Configuration updated via Web API');
    if (app.locals.onConfigSaved) {
      app.locals.onConfigSaved();
    }
    res.json({ success: true, message: 'Config saved and applied successfully.' });
  });

  app.get('/api/status', (req, res) => {
    res.json(getStatus());
  });

  app.get('/api/network-interfaces', (req, res) => {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    const ips = ['0.0.0.0', '127.0.0.1'];

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        // Skip internal/loopback since we already added 127.0.0.1
        if (!iface.internal && iface.family === 'IPv4') {
          ips.push(iface.address);
        }
      }
    }

    // Remove duplicates
    res.json(Array.from(new Set(ips)));
  });

  // 返回物理网卡列表（用于路由器选择）
  app.get('/api/router/interfaces', (req, res) => {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    const list = [];
    for (const name of Object.keys(interfaces)) {
      // 跳过 TUN 虚拟网卡和 loopback
      if (/^(lo|Loopback)/i.test(name)) continue;
      if (/tun/i.test(name) && !/tun/i.test(req.query.includeTun || '')) continue;
      const addrs = (interfaces[name] || []).filter(a => a.family === 'IPv4');
      if (addrs.length === 0) continue;
      list.push({
        name,
        address: addrs[0].address,
        netmask: addrs[0].netmask,
        mac: addrs[0].mac || (interfaces[name].find(a => a.mac) || {}).mac || '',
        internal: addrs[0].internal
      });
    }
    res.json({ success: true, interfaces: list });
  });

  // ============== 路由器系统 ==============
  app.get('/api/router/config', (req, res) => {
    const cfg = configManager.getConfig();
    const rs = cfg.routerSystem || {};
    const routerManager = require('../core/routerManager');
    res.json({
      success: true,
      config: rs,
      running: routerManager.isRunning()
    });
  });

  app.post('/api/router/config', (req, res) => {
    const currentConfig = configManager.getConfig();
    const incoming = req.body || {};
    if (!currentConfig.routerSystem) currentConfig.routerSystem = {};
    const rs = currentConfig.routerSystem;
    // 仅允许通过此接口更新配置字段，不直接覆盖 devices（避免前端误删）
    Object.assign(rs, {
      name: incoming.name,
      interface: incoming.interface,
      subnetCidr: incoming.subnetCidr,
      upstreamMode: incoming.upstreamMode,
      upstreamProxyId: incoming.upstreamProxyId
    });
    if (incoming.dhcp) {
      rs.dhcp = Object.assign({}, rs.dhcp || {}, incoming.dhcp);
    }
    if (incoming.macFilter) {
      rs.macFilter = Object.assign({}, rs.macFilter || {}, incoming.macFilter);
    }
    if (Array.isArray(incoming.staticBindings)) {
      rs.staticBindings = incoming.staticBindings;
    }
    configManager.saveConfig(currentConfig);
    getLogger().info('[API] router config saved');
    res.json({ success: true });
  });

  app.post('/api/router/start', async (req, res) => {
    const routerManager = require('../core/routerManager');
    try {
      const currentConfig = configManager.getConfig();
      const rs = currentConfig.routerSystem || {};
      if (!rs.interface) {
        return res.json({ success: false, message: '请先选择网卡' });
      }
      if (!rs.subnetCidr) {
        return res.json({ success: false, message: '请先配置网段' });
      }
      await routerManager.start(rs, () => configManager.getConfig(), (c) => configManager.saveConfig(c), (type, payload) => {
        if (app.locals.broadcastWsMessage) {
          app.locals.broadcastWsMessage({ type: 'router_event', data: { type, payload } });
          // 同步推送设备列表
          const reg = routerManager.getDeviceRegistry();
          if (reg) {
            app.locals.broadcastWsMessage({ type: 'router_devices', data: reg.listDevices() });
          }
        }
      });
      // 写入启用状态
      rs.enabled = true;
      configManager.saveConfig(currentConfig);
      res.json({ success: true });
    } catch (err) {
      getLogger().error(`[API] router start failed: ${err.message}`);
      res.json({ success: false, message: err.message });
    }
  });

  app.post('/api/router/stop', async (req, res) => {
    const routerManager = require('../core/routerManager');
    try {
      await routerManager.stop();
      const currentConfig = configManager.getConfig();
      if (currentConfig.routerSystem) {
        currentConfig.routerSystem.enabled = false;
        configManager.saveConfig(currentConfig);
      }
      res.json({ success: true });
    } catch (err) {
      getLogger().error(`[API] router stop failed: ${err.message}`);
      res.json({ success: false, message: err.message });
    }
  });

  app.get('/api/router/devices', (req, res) => {
    const routerManager = require('../core/routerManager');
    const reg = routerManager.getDeviceRegistry();
    if (!reg) {
      const cfg = configManager.getConfig();
      return res.json({ success: true, devices: cfg.routerSystem?.devices || [] });
    }
    res.json({ success: true, devices: reg.listDevices() });
  });

  app.post('/api/router/devices/:mac/toggle', (req, res) => {
    const routerManager = require('../core/routerManager');
    const reg = routerManager.getDeviceRegistry();
    if (!reg) return res.json({ success: false, message: '路由器未启动' });
    const enabled = req.body.enabled;
    const ok = reg.setDeviceEnabled(req.params.mac, enabled);
    if (ok && app.locals.broadcastWsMessage) {
      app.locals.broadcastWsMessage({ type: 'router_devices', data: reg.listDevices() });
    }
    res.json({ success: ok });
  });

  app.post('/api/router/devices/:mac/kick', (req, res) => {
    const routerManager = require('../core/routerManager');
    const reg = routerManager.getDeviceRegistry();
    if (!reg) return res.json({ success: false, message: '路由器未启动' });
    const ok = reg.kickDevice(req.params.mac);
    if (ok && app.locals.broadcastWsMessage) {
      app.locals.broadcastWsMessage({ type: 'router_devices', data: reg.listDevices() });
    }
    res.json({ success: ok });
  });

  app.delete('/api/router/devices/:mac', (req, res) => {
    const routerManager = require('../core/routerManager');
    const reg = routerManager.getDeviceRegistry();
    if (!reg) return res.json({ success: false, message: '路由器未启动' });
    const ok = reg.deleteDevice(req.params.mac);
    if (ok && app.locals.broadcastWsMessage) {
      app.locals.broadcastWsMessage({ type: 'router_devices', data: reg.listDevices() });
    }
    res.json({ success: ok });
  });
  app.get('/api/traffic-logs', (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = parseInt(req.query.offset, 10) || 0;
    const queryParams = {
      target: req.query.target,
      module: req.query.module,
      action: req.query.action,
      clientId: req.query.clientId,
      sourceIp: req.query.sourceIp,
      status: req.query.status,
      rulePattern: req.query.rulePattern
    };
    res.json(trafficLogger.getLogs(limit, offset, queryParams));
  });

  app.get('/api/traffic-logs/recording', (req, res) => {
    res.json({ enabled: trafficLogger.isEnabled() });
  });

  app.post('/api/traffic-logs/recording', (req, res) => {
    const enabled = !!req.body.enabled;
    trafficLogger.setEnabled(enabled);
    getLogger().info(`[Traffic] Recording ${enabled ? 'enabled' : 'disabled'}`);
    res.json({ success: true, enabled: trafficLogger.isEnabled() });
  });

  app.delete('/api/traffic-logs', (req, res) => {
    trafficLogger.clear();
    getLogger().info('[Traffic] Logs cleared');
    res.json({ success: true });
  });

  app.post('/api/tunnel/:mode/start', async (req, res) => {
    const { mode } = req.params;
    if (app.locals.startTunnel) {
      try {
        await app.locals.startTunnel(mode);
        getLogger().info(`Tunnel started manually via API in mode: ${mode}`);
        res.json({ success: true, message: `Tunnel started in ${mode} mode.` });
      } catch (err) {
        if (err.code === 'PORT_IN_USE') {
          res.json({ success: false, code: 'PORT_IN_USE', port: err.port, message: `端口 ${err.port} 被占用` });
        } else {
          res.status(500).json({ success: false, message: err.message || '启动失败' });
        }
      }
    } else {
      res.status(500).json({ success: false, message: 'Tunnel control not bound.' });
    }
  });

  app.post('/api/kill-port/:port', (req, res) => {
    const port = parseInt(req.params.port);
    if (!port) return res.status(400).json({ success: false, message: 'Port is required' });

    const { exec } = require('child_process');
    // Find PID on Windows using netstat and findstr
    exec(`netstat -ano | findstr :${port}`, (err, stdout) => {
      if (err || !stdout) {
        return res.json({ success: false, message: `未找到占用端口 ${port} 的进程` });
      }
      
      const lines = stdout.trim().split('\n');
      let targetPid = null;
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        // Protocol, Local Address, Foreign Address, State, PID
        if (parts.length >= 4 && parts[1].endsWith(`:${port}`) && parts[parts.length - 1] !== '0') {
          targetPid = parts[parts.length - 1];
          break;
        }
      }

      if (!targetPid) {
        return res.json({ success: false, message: `未找到占用端口 ${port} 的有效 PID` });
      }

      exec(`taskkill /PID ${targetPid} /F`, (killErr) => {
        if (killErr) {
          return res.json({ success: false, message: `强杀进程 ${targetPid} 失败: ${killErr.message}` });
        }
        res.json({ success: true, message: `成功结束进程 ${targetPid}，端口 ${port} 已释放` });
      });
    });
  });

  // 检查端口是否可绑定（用于启用代理前的实时校验）
  app.get('/api/check-port/:port', (req, res) => {
    const port = parseInt(req.params.port);
    if (!port) return res.status(400).json({ success: false, message: 'Port is required' });
    const tester = net.createServer();
    tester.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        res.json({ success: true, available: false, message: `端口 ${port} 已被占用` });
      } else {
        res.json({ success: true, available: false, message: `端口 ${port} 检查失败: ${err.message}` });
      }
    });
    tester.once('listening', () => {
      tester.close(() => {
        res.json({ success: true, available: true, message: `端口 ${port} 可用` });
      });
    });
    tester.listen(port, '0.0.0.0');
  });

  // 验证单个 DNS 服务器是否可用（支持纯IP/udp://IP/tcp://IP/https://IP/tls://IP）
  // 规范化后的地址通过临时设置 resolver 服务器来测试，仅对纯IP/udp/tcp 有效
  app.post('/api/dns-test', async (req, res) => {
    const { address } = req.body || {};
    if (!address || typeof address !== 'string') {
      return res.json({ success: false, valid: false, message: '地址不能为空' });
    }
    // 检测 TUN/系统代理状态：开启时 DNS 验证会被 TUN 拦截导致不准
    const cfg = configManager.getConfig();
    const tunActive = cfg.tunModeEnabled === true;
    const sysProxyActive = cfg.globalProxyEnabled === true;
    const addr = address.trim();
    // 解析出 IP/域名、端口与协议
    let ip = addr;
    let port = 53;
    let protocol = 'udp';
    const m1 = addr.match(/^(udp|tcp|https|tls|quic):\/\/(.+)$/i);
    if (m1) {
      protocol = m1[1].toLowerCase();
      const rest = m1[2];
      const m2 = rest.match(/^([^:/]+)(?::(\d+))?(.*)$/);
      if (!m2) return res.json({ success: false, valid: false, message: '地址格式错误' });
      ip = m2[1];
      if (m2[2]) port = parseInt(m2[2]);
      if (protocol === 'https' || protocol === 'tls' || protocol === 'quic') port = port || 443;
    } else {
      const m3 = addr.match(/^([^:]+)(?::(\d+))?$/);
      if (!m3) return res.json({ success: false, valid: false, message: '地址格式错误' });
      ip = m3[1];
      if (m3[2]) port = parseInt(m3[2]);
    }

    const startTs = Date.now();
    const TIMEOUT_MS = 5000;
    const testDomain = 'www.baidu.com';

    // 统一硬超时 + 响应标志，强制保证 5 秒内一定返回 JSON
    let responded = false;
    const finalize = (result) => {
      if (responded) return;
      responded = true;
      clearTimeout(hardTimer);
      const elapsed = Date.now() - startTs;
      res.json({ success: true, ...result, message: `${result.message}（${elapsed}ms）`, ip, port, protocol });
    };
    const hardTimer = setTimeout(() => {
      finalize({ valid: false, message: `验证超时（${TIMEOUT_MS}ms 强制终止）` });
    }, TIMEOUT_MS + 500); // 比内部超时多 500ms 兜底

    // ---- UDP DNS 验证：用 dns.Resolver ----
    if (protocol === 'udp') {
      // TUN/系统代理开启时，node 的 UDP 出站会被拦截走代理，验证结果不准
      // 降级为：仅校验 IP 可达性 + 用系统默认 DNS 做参考解析
      if (tunActive || sysProxyActive) {
        const warn = tunActive ? 'TUN 模式开启中' : '系统代理开启中';
        // 用系统默认 DNS 解析测试域名，证明网络可达
        dns.resolve4(testDomain, (err, addresses) => {
          if (err) {
            finalize({ valid: false, message: `${warn}，验证受限且系统 DNS 解析失败: ${err.code || err.message}` });
          } else if (addresses && addresses.length > 0) {
            finalize({ valid: true, message: `${warn}，已跳过对该 DNS 的直连测试（流量被 TUN/代理接管），系统 DNS 参考解析成功` });
          } else {
            finalize({ valid: false, message: `${warn}，系统 DNS 返回空结果` });
          }
        });
        return;
      }
      // 用独立子进程验证，避免主进程网络栈被 TUN/代理历史状态污染
      const { execFile } = require('child_process');
      const script = `const dns=require('dns');const r=new dns.Resolver();try{r.setServers([${JSON.stringify(ip)}]);}catch(e){process.stdout.write(JSON.stringify({valid:false,message:'设置服务器失败: '+e.message}));process.exit(0);}r.resolve4(${JSON.stringify(testDomain)},(e,a)=>{if(e)process.stdout.write(JSON.stringify({valid:false,message:'解析失败: '+(e.code||e.message)}));else if(a&&a.length)process.stdout.write(JSON.stringify({valid:true,message:'可用，解析到 '+a[0]+' 等 '+a.length+' 条',sample:a[0]}));else process.stdout.write(JSON.stringify({valid:false,message:'返回空结果'}));});`;
      const child = execFile('node', ['-e', script], { timeout: TIMEOUT_MS + 1000, cwd: __dirname }, (err, stdout, stderr) => {
        if (err) {
          // 子进程超时或崩溃
          if (err.killed || err.signal === 'SIGTERM') {
            return finalize({ valid: false, message: '验证超时（子进程）' });
          }
          return finalize({ valid: false, message: `验证失败: ${err.message}` });
        }
        try {
          const result = JSON.parse(stdout.trim());
          finalize(result);
        } catch (e) {
          finalize({ valid: false, message: `解析子进程输出失败: ${stdout.slice(0, 100)}` });
        }
      });
      return;
    }

    // ---- TCP DNS 验证：手动构造 DNS query 报文，通过 net.Socket 发送 ----
    if (protocol === 'tcp') {
      if (tunActive || sysProxyActive) {
        const warn = tunActive ? 'TUN 模式开启中' : '系统代理开启中';
        return finalize({ valid: true, message: `${warn}，已跳过 TCP 直连测试（流量被 TUN/代理接管），地址格式有效` });
      }
      const buildDnsQuery = () => {
        const labels = testDomain.split('.').filter(Boolean);
        let qname = Buffer.alloc(0);
        labels.forEach(l => {
          const buf = Buffer.alloc(1 + l.length);
          buf.writeUInt8(l.length, 0);
          buf.write(l, 1, 'ascii');
          qname = Buffer.concat([qname, buf]);
        });
        qname = Buffer.concat([qname, Buffer.from([0])]); // 终止 0
        const header = Buffer.alloc(12);
        const id = Math.floor(Math.random() * 65535);
        header.writeUInt16BE(id, 0);
        header.writeUInt16BE(0x0100, 2); // RD=1
        header.writeUInt16BE(1, 4);      // QDCOUNT=1
        const question = Buffer.concat([qname, Buffer.from([0, 1, 0, 1])]); // QTYPE=A, QCLASS=IN
        const body = Buffer.concat([header, question]);
        const lenBuf = Buffer.alloc(2);
        lenBuf.writeUInt16BE(body.length, 0);
        return Buffer.concat([lenBuf, body]);
      };

      const socket = new net.Socket();
      const cleanup = () => { try { socket.destroy(); } catch (e) {} };
      socket.setTimeout(TIMEOUT_MS);
      socket.on('timeout', () => { cleanup(); finalize({ valid: false, message: `连接超时（TCP ${ip}:${port}）` }); });
      socket.on('error', (err) => { cleanup(); finalize({ valid: false, message: `连接失败: ${err.code || err.message}` }); });
      socket.on('connect', () => { socket.write(buildDnsQuery()); });
      let received = Buffer.alloc(0);
      socket.on('data', (data) => {
        received = Buffer.concat([received, data]);
        if (received.length >= 14) {
          const expectedLen = received.readUInt16BE(0);
          if (received.length >= 2 + expectedLen) {
            const dnsHeader = received.slice(2, 14);
            const ancount = dnsHeader.readUInt16BE(6);
            cleanup();
            if (ancount > 0) {
              finalize({ valid: true, message: `可用，解析到 ${ancount} 条记录` });
            } else {
              finalize({ valid: false, message: '服务器响应无应答记录' });
            }
          }
        }
      });
      socket.connect(port, ip);
      return;
    }

    // ---- DoH (HTTPS) 验证：发送 application/dns-json 查询 ----
    if (protocol === 'https') {
      if (tunActive || sysProxyActive) {
        const warn = tunActive ? 'TUN 模式开启中' : '系统代理开启中';
        return finalize({ valid: true, message: `${warn}，已跳过 DoH 直连测试（流量被 TUN/代理接管），地址格式有效` });
      }
      let dohUrl;
      try {
        dohUrl = new URL(addr);
      } catch (e) {
        return finalize({ valid: false, message: `DoH URL 解析失败: ${e.message}` });
      }
      const queryUrl = `${dohUrl.origin}${dohUrl.pathname || '/dns-query'}?name=${encodeURIComponent(testDomain)}&type=A`;
      const req = https.get(queryUrl, { headers: { 'Accept': 'application/dns-json' }, timeout: TIMEOUT_MS }, (resp) => {
        let body = '';
        resp.on('data', (chunk) => { body += chunk; });
        resp.on('end', () => {
          if (resp.statusCode !== 200) {
            return finalize({ valid: false, message: `HTTP ${resp.statusCode}` });
          }
          try {
            const json = JSON.parse(body);
            const answers = (json.Answer || json.Answers || []);
            if (answers.length > 0) {
              const first = answers[0].data || '';
              finalize({ valid: true, message: `可用，解析到 ${first} 等 ${answers.length} 条`, sample: first });
            } else {
              finalize({ valid: false, message: '无应答记录' });
            }
          } catch (e) {
            finalize({ valid: true, message: '可达（HTTP 200，非 JSON 响应）' });
          }
        });
      });
      req.on('error', (err) => finalize({ valid: false, message: `请求失败: ${err.code || err.message}` }));
      req.on('timeout', () => { try { req.destroy(); } catch (e) {} finalize({ valid: false, message: '请求超时' }); });
      return;
    }

    // ---- DoT (TLS) / QUIC：暂只做格式校验 ----
    return finalize({ valid: true, message: `格式有效（${protocol.toUpperCase()} 协议，将在 TUN 启用时实际生效）` });
  });

  // 返回当前系统 DNS 服务器列表
  app.get('/api/system-dns', (req, res) => {
    try {
      const list = dns.getServers();
      res.json({ success: true, servers: list });
    } catch (e) {
      res.json({ success: false, servers: [], message: e.message });
    }
  });

  app.get('/api/xray-status', (req, res) => {
    const xrayManager = require('../core/xrayManager');
    res.json(xrayManager.getStatus());
  });

  app.post('/api/tunnel/:mode/stop', (req, res) => {
    const { mode } = req.params;
    if (app.locals.stopTunnel) {
      app.locals.stopTunnel(mode);
      getLogger().info(`Tunnel stopped manually via API in mode: ${mode}`);
      res.json({ success: true, message: `Tunnel stopped in ${mode} mode.` });
    } else {
      res.status(500).json({ success: false, message: 'Tunnel control not bound.' });
    }
  });

  const dns = require('dns').promises;
  async function resolveHost(host) {
    if (!host) return null;
    if (net.isIP(host)) return host;
    try {
      const res = await dns.lookup(host);
      return res.address;
    } catch (e) {
      return null;
    }
  }

  app.post('/api/system-proxy/enable', async (req, res) => {
    const { host, port } = req.body;
    if (!port) {
      return res.status(400).json({ success: false, message: 'Port is required' });
    }
    const success = await enableSystemProxy(host || '127.0.0.1', port);
    if (success) {
      const currentConfig = configManager.getConfig();
      currentConfig.globalProxyEnabled = true;
      currentConfig.globalProxyPort = port;
      configManager.saveConfig(currentConfig);
    }
    res.json({ success });
  });

  app.post('/api/system-proxy/disable', async (req, res) => {
    const success = await disableSystemProxy();
    if (success) {
      const currentConfig = configManager.getConfig();
      currentConfig.globalProxyEnabled = false;
      configManager.saveConfig(currentConfig);
    }
    res.json({ success });
  });

  app.get('/api/tun/status', (req, res) => {
    const xrayManager = require('../core/xrayManager');
    res.json(xrayManager.getTunStatus());
  });

  app.post('/api/tun/enable', async (req, res) => {
    const { port } = req.body;
    if (!port) {
      return res.status(400).json({ success: false, message: 'Port is required' });
    }

    const routeManager = require('../utils/routeManager');
    const xrayManager = require('../core/xrayManager');

    try {
      // 1. Stop any existing TUN and clear bypasses
      await xrayManager.stopTun();
      await routeManager.clearAllBypasses();

      // 2. Add bypass routes
      const gatewayInfo = await routeManager.getDefaultGateway();
      if (gatewayInfo) {
        const config = configManager.getConfig();
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

      // 3. Start TUN core
      await xrayManager.startTun(port);

      // 4. Save config
      const currentConfig = configManager.getConfig();
      currentConfig.tunModeEnabled = true;
      currentConfig.tunProxyPort = port;
      configManager.saveConfig(currentConfig);

      res.json({ success: true });
    } catch (err) {
      getLogger().error(`[API] Failed to enable TUN mode: ${err.message}`);
      res.json({ success: false, message: err.message });
    }
  });

  app.post('/api/tun/disable', async (req, res) => {
    const routeManager = require('../utils/routeManager');
    const xrayManager = require('../core/xrayManager');

    try {
      await xrayManager.stopTun();
      await routeManager.clearAllBypasses();

      const currentConfig = configManager.getConfig();
      currentConfig.tunModeEnabled = false;
      configManager.saveConfig(currentConfig);

      res.json({ success: true });
    } catch (err) {
      getLogger().error(`[API] Failed to disable TUN mode: ${err.message}`);
      res.json({ success: false, message: err.message });
    }
  });

  app.post('/api/test-latency', (req, res) => {
    const { type, id } = req.body;
    const globalConfig = configManager.getConfig();
    let nodesToDial = [];

    if (type === 'node') {
      const node = globalConfig.proxyNodes?.find(n => n.id === id);
      if (!node) return res.status(404).json({ success: false, message: 'Node not found' });
      nodesToDial = [node];
    } else if (type === 'chain') {
      const chain = globalConfig.proxyChains?.find(c => c.id === id);
      if (!chain) return res.status(404).json({ success: false, message: 'Chain not found' });
      nodesToDial = chain.nodes.map(ref => globalConfig.proxyNodes?.find(n => n.id === ref)).filter(Boolean);
      // Only one v2ray node is supported in a chain test; it must be the first
      const v2rayNodes = nodesToDial.filter(n => n.type === 'v2ray');
      const nonV2rayNodes = nodesToDial.filter(n => n.type !== 'v2ray');
      nodesToDial = v2rayNodes.length > 0 ? [v2rayNodes[0], ...nonV2rayNodes] : [...nonV2rayNodes];
      if (nodesToDial.length === 0) return res.status(400).json({ success: false, message: 'Chain has no valid nodes' });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid test type' });
    }

    const startTime = Date.now();
    // 使用 Google DNS 作为目标：纯 IP 无 DNS 解析干扰，国外节点延迟更真实
    const targetHost = req.body.targetHost || '8.8.8.8';
    const targetPort = parseInt(req.body.targetPort) || 443;

    ProxyDialer.dialChain(nodesToDial, targetHost, targetPort, false, null, (err, socket) => {
      if (err) {
        return res.json({ success: false, message: err.message, latency: 0 });
      }

      // dialChain 完成 = 代理已建立到目标的 TCP 连接。
      // 为避免 v2ray 本地握手过快导致 1ms 这种异常值，
      // 额外做一次 TLS 握手确认目标可达，让延迟更真实。
      const tls = require('tls');
      const tlsSocket = tls.connect({
        socket: socket,
        servername: targetHost,
        rejectUnauthorized: false
      });

      let responded = false;
      const finish = (ok, errMsg) => {
        if (responded) return;
        responded = true;
        clearTimeout(timeoutHandle);
        tlsSocket.destroy();
        socket.destroy();
        const latency = Date.now() - startTime;
        if (ok) {
          res.json({ success: true, message: 'OK', latency });
        } else {
          res.json({ success: false, message: errMsg || 'TLS 握手失败', latency });
        }
      };

      const timeoutHandle = setTimeout(() => finish(false, '延迟测试超时'), 10000);
      tlsSocket.on('secureConnect', () => finish(true));
      tlsSocket.on('error', (e) => finish(false, `TLS 错误: ${e.message}`));
      socket.on('error', (e) => finish(false, `连接错误: ${e.message}`));
      socket.on('close', () => finish(false, '连接已关闭'));
    });
  });

  app.post('/api/test-proxy', (req, res) => {
    const { type, host, port, username, password, targetUrl, tls: useTls, sni } = req.body;
    let logs = [];
    const log = (msg) => logs.push(`[${new Date().toISOString()}] ${msg}`);

    log(`Starting proxy test...`);
    log(`Proxy: ${type}://${host}:${port}${useTls ? ' (TLS)' : ''}`);
    if (username) log(`Auth provided: Yes`);
    log(`Target: ${targetUrl}`);

    try {
      const parsedUrl = new URL(targetUrl);
      const targetHost = parsedUrl.hostname;
      const targetPort = parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80);

      const onConnected = (socket) => {
        log(`Connected to proxy at ${host}:${port}${useTls ? ' (TLS)' : ''}`);

        let responseData = Buffer.alloc(0);
        let completed = false;

        // Timeout handler
        const timeout = setTimeout(() => {
          if (!completed) {
            completed = true;
            log('Error: Connection timed out after 10 seconds');
            socket.destroy();
            res.json({ success: false, logs });
          }
        }, 10000);

        socket.on('data', (d) => {
          responseData = Buffer.concat([responseData, d]);
          if (type === 'http') {
            const respStr = responseData.toString('utf8');
            if (respStr.includes('\r\n\r\n')) {
              completed = true;
              clearTimeout(timeout);
              const firstLine = respStr.split('\r\n')[0];
              log(`Received response: ${firstLine}`);
              if (firstLine.includes('200')) {
                log('Test Successful!');
                res.json({ success: true, logs });
              } else {
                log('Test Failed. Proxy returned an error.');
                res.json({ success: false, logs });
              }
              socket.destroy();
            }
          } else if (type === 'socks5') {
            // Very simplified SOCKS5 handshake tracking
            if (responseData.length === 2 && responseData[0] === 0x05) {
              if (responseData[1] === 0xff) {
                completed = true;
                clearTimeout(timeout);
                log('Error: SOCKS5 Authentication methods rejected (0xFF)');
                res.json({ success: false, logs });
                socket.destroy();
                return;
              }
              log(`SOCKS5 Initial Handshake successful (Method: ${responseData[1]}).`);
              if (responseData[1] === 0x02) {
                log('Server requests Username/Password auth. Sending credentials...');
                const userBuf = Buffer.from(username || '');
                const passBuf = Buffer.from(password || '');
                const authReq = Buffer.concat([Buffer.from([0x01, userBuf.length]), userBuf, Buffer.from([passBuf.length]), passBuf]);
                socket.write(authReq);
                responseData = Buffer.alloc(0);
              } else {
                log('Sending CONNECT request...');
                const hostLen = Buffer.from(targetHost).length;
                const reqBuf = Buffer.alloc(4 + 1 + hostLen + 2);
                reqBuf.writeUInt8(0x05, 0);
                reqBuf.writeUInt8(0x01, 1); // CONNECT
                reqBuf.writeUInt8(0x00, 2); // RSV
                reqBuf.writeUInt8(0x03, 3); // DOMAIN
                reqBuf.writeUInt8(hostLen, 4);
                reqBuf.write(targetHost, 5, 'ascii');
                reqBuf.writeUInt16BE(targetPort, 5 + hostLen);
                socket.write(reqBuf);
                responseData = Buffer.alloc(0);
              }
            } else if (responseData.length >= 2 && responseData[0] === 0x01) {
              // Auth response
              if (responseData[1] === 0x00) {
                 log('SOCKS5 Authentication successful! Sending CONNECT request...');
                 const hostLen = Buffer.from(targetHost).length;
                 const reqBuf = Buffer.alloc(4 + 1 + hostLen + 2);
                 reqBuf.writeUInt8(0x05, 0);
                 reqBuf.writeUInt8(0x01, 1); // CONNECT
                 reqBuf.writeUInt8(0x00, 2); // RSV
                 reqBuf.writeUInt8(0x03, 3); // DOMAIN
                 reqBuf.writeUInt8(hostLen, 4);
                 reqBuf.write(targetHost, 5, 'ascii');
                 reqBuf.writeUInt16BE(targetPort, 5 + hostLen);
                 socket.write(reqBuf);
                 responseData = Buffer.alloc(0);
              } else {
                 completed = true;
                 clearTimeout(timeout);
                 log('Error: SOCKS5 Authentication failed!');
                 res.json({ success: false, logs });
                 socket.destroy();
              }
            } else if (responseData.length >= 10 && responseData[0] === 0x05) {
              completed = true;
              clearTimeout(timeout);
              if (responseData[1] === 0x00) {
                 log('SOCKS5 Test Successful! Connection established to target.');
                 res.json({ success: true, logs });
              } else {
                 log(`Error: SOCKS5 connection failed with reply code ${responseData[1]}`);
                 res.json({ success: false, logs });
              }
              socket.destroy();
            }
          }
        });

        socket.on('error', (err) => {
          if (!completed) {
            completed = true;
            clearTimeout(timeout);
            log(`TCP Error: ${err.message}`);
            res.json({ success: false, logs });
          }
        });

        socket.on('close', () => {
          if (!completed) {
            completed = true;
            clearTimeout(timeout);
            log(`Connection closed by server unexpectedly.`);
            res.json({ success: false, logs });
          }
        });

        if (type === 'http') {
          let authHeader = '';
          if (username) {
            const b64 = Buffer.from(`${username}:${password || ''}`).toString('base64');
            authHeader = `\r\nProxy-Authorization: Basic ${b64}`;
          }
          log(`Sending HTTP CONNECT request...`);
          socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}${authHeader}\r\n\r\n`);
        } else if (type === 'socks5') {
          log(`Sending SOCKS5 initial greeting...`);
          const methods = username ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]);
          socket.write(methods);
        }
      };

      // 建立连接：HTTP 代理服务器若启用 TLS，则用 tls.connect
      if (useTls && type === 'http') {
        const tlsSocket = tls.connect({
          host,
          port,
          servername: sni || host,
          rejectUnauthorized: false
        }, () => onConnected(tlsSocket));
        tlsSocket.on('error', (err) => {
          log(`TLS Error: ${err.message}`);
          res.json({ success: false, logs });
        });
      } else {
        const socket = net.connect(port, host, () => onConnected(socket));
        socket.on('error', (err) => {
          log(`TCP Error: ${err.message}`);
          res.json({ success: false, logs });
        });
      }
    } catch (err) {
      log(`Error preparing test: ${err.message}`);
      res.json({ success: false, logs });
    }
  });

  app.post('/api/fetch-subscription', async (req, res) => {
    let { url, subName, subGroup } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'URL is required' });
    
    const urls = url.split('\n').map(u => u.trim()).filter(u => u);
    let allNodes = [];
    
    const fetchUrl = (targetUrl, redirects = 0) => {
      return new Promise((resolve) => {
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
          targetUrl = 'http://' + targetUrl;
        }
        if (redirects > 5) return resolve({ success: false, message: 'Too many redirects' });
        
        const client = targetUrl.startsWith('https') ? https : http;
        try {
          const reqOpts = { headers: { 'User-Agent': 'Bi-Tunnel-Client/1.0' } };
          client.get(targetUrl, reqOpts, (resp) => {
            if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
              let nextUrl = resp.headers.location;
              if (!nextUrl.startsWith('http')) {
                const { URL } = require('url');
                nextUrl = new URL(nextUrl, targetUrl).toString();
              }
              return resolve(fetchUrl(nextUrl, redirects + 1));
            }
            
            let data = '';
            resp.on('data', (chunk) => { data += chunk; });
            resp.on('end', () => {
              try {
                let decoded = data.trim();
                if (!decoded.includes('://') && /^[A-Za-z0-9+/=\s]+$/.test(decoded)) {
                   try {
                     decoded = Buffer.from(decoded.replace(/\s/g, ''), 'base64').toString('utf8');
                   } catch(e) {}
                }
                
                const lines = decoded.split('\n').map(s => s.trim()).filter(s => s);
                const { parseProxyUrl } = require('../utils/v2rayParser');
                const nodes = [];
                for (const u of lines) {
                  const parsed = parseProxyUrl(u);
                  if (parsed) {
                    let baseNode = {
                      displayName: parsed.displayName || `${parsed.type.toUpperCase()} Node`,
                      group: subGroup || 'default',
                      subName: subName || 'Default Sub',
                      type: parsed.type,
                      host: parsed.host,
                      port: parsed.port
                    };
                    if (parsed.type === 'v2ray') {
                      nodes.push({ ...baseNode, v2rayType: parsed.v2rayType, rawUrl: parsed.rawUrl });
                    } else {
                      nodes.push({ ...baseNode, user: parsed.user, pass: parsed.pass });
                    }
                  }
                }
                resolve({ success: true, nodes });
              } catch (e) {
                resolve({ success: false, message: 'Parse error: ' + e.message });
              }
            });
          }).on('error', (err) => {
            resolve({ success: false, message: 'Fetch error: ' + err.message });
          });
        } catch (err) {
          resolve({ success: false, message: 'Request failed: ' + err.message });
        }
      });
    };

    let errors = [];
    for (const u of urls) {
      const result = await fetchUrl(u);
      if (result.success && result.nodes) {
        allNodes.push(...result.nodes);
      } else {
        errors.push(`URL ${u}: ${result.message}`);
      }
    }
    
    if (allNodes.length > 0) {
      res.json({ success: true, nodes: allNodes, errors: errors.length ? errors : undefined });
    } else {
      res.json({ success: false, message: 'Failed to fetch any nodes. ' + errors.join(' | ') });
    }
  });



  app.post('/api/service/stop', (req, res) => {
    getLogger().info('[Service] Stop requested via Web API, shutting down...');
    res.json({ success: true, message: '服务正在停止...' });
    setTimeout(async () => {
      const { disableSystemProxy } = require('../utils/systemProxy');
      const xrayManager = require('../core/xrayManager');
      const routeManager = require('../utils/routeManager');

      try { await disableSystemProxy(); } catch (e) {}
      try { await xrayManager.stopTun(); } catch (e) {}
      try { await routeManager.clearAllBypasses(); } catch (e) {}

      const { stopXray } = require('../core/xrayManager');
      stopXray();
      if (app.locals.server) {
        app.locals.server.close();
      }
      if (app.locals.httpServer) {
        app.locals.httpServer.close();
      }
      setTimeout(() => process.exit(0), 500);
    }, 500);
  });

  app.post('/api/service/restart', (req, res) => {
    getLogger().info('[Service] Restart requested via Web API, restarting...');
    res.json({ success: true, message: '服务正在重启...' });
    setTimeout(async () => {
      const { disableSystemProxy } = require('../utils/systemProxy');
      const xrayManager = require('../core/xrayManager');
      const routeManager = require('../utils/routeManager');

      try { await disableSystemProxy(); } catch (e) {}
      try { await xrayManager.stopTun(); } catch (e) {}
      try { await routeManager.clearAllBypasses(); } catch (e) {}

      // 停止所有隧道和转发（释放所有端口）
      if (app.locals.stopTunnel) {
        try { app.locals.stopTunnel('server'); } catch (e) {}
        try { app.locals.stopTunnel('client'); } catch (e) {}
      }
      // 强制关闭 WebSocket 连接
      if (app.locals.wss) {
        app.locals.wss.clients.forEach(ws => {
          try { ws.terminate(); } catch (e) {}
        });
        try { app.locals.wss.close(); } catch (e) {}
      }
      // 关闭 HTTPS 服务器，强制断开所有连接
      if (app.locals.server) {
        if (app.locals.server.closeAllConnections) {
          app.locals.server.closeAllConnections();
        }
        app.locals.server.close();
      }
      // 关闭 HTTP 服务器
      if (app.locals.httpServer) {
        if (app.locals.httpServer.closeAllConnections) {
          app.locals.httpServer.closeAllConnections();
        }
        app.locals.httpServer.close();
      }
      // 写一个外部批处理脚本：等旧进程退出后重新启动
      const { writeFileSync } = require('fs');
      const { join } = require('path');
      const os = require('os');
      const cwd = process.cwd();
      let restartScript, runCmd;
      if (os.platform() === 'win32') {
        restartScript = join(os.tmpdir(), 'bi-tunnel-restart.bat');
        writeFileSync(restartScript, `@echo off\r\ntimeout /t 3 /nobreak > nul\r\ncd /d "${cwd}"\r\nnpm start\r\n`);
        // 用 cmd /c start 在新窗口启动，完全脱离当前进程
        runCmd = `cmd /c start "" "${restartScript}"`;
      } else {
        restartScript = join(os.tmpdir(), 'bi-tunnel-restart.sh');
        writeFileSync(restartScript, `#!/bin/bash\nsleep 3\ncd "${cwd}"\nnpm start\n`);
        require('fs').chmodSync(restartScript, '755');
        runCmd = `bash "${restartScript}"`;
      }
      const { exec } = require('child_process');
      exec(runCmd, { detached: true, cwd });
      getLogger().info('[Service] Restart script executed, exiting current process...');
      process.exit(0);
    }, 500);
  });

  app.post('/api/test-speed', (req, res) => {
    const { type, id, targetHost, targetPort } = req.body;
    const config = configManager.getConfig();
    let nodesToDial = [];

    if (type === 'chain') {
      const chain = config.proxyChains?.find(c => c.id === id);
      if (!chain) return res.status(404).json({ success: false, message: 'Chain not found' });
      nodesToDial = chain.nodes.map(ref => config.proxyNodes?.find(n => n.id === ref)).filter(Boolean);
      // Only one v2ray node is supported in a chain test; it must be the first
      const v2rayNodes = nodesToDial.filter(n => n.type === 'v2ray');
      const nonV2rayNodes = nodesToDial.filter(n => n.type !== 'v2ray');
      nodesToDial = v2rayNodes.length > 0 ? [v2rayNodes[0], ...nonV2rayNodes] : [...nonV2rayNodes];
      if (nodesToDial.length === 0) return res.status(400).json({ success: false, message: 'Chain has no valid nodes' });
    } else {
      let node = config.proxyNodes?.find(n => n.id === id);
      if (!node) {
        let chain = config.proxyChains?.find(c => c.id === id);
        if (chain && chain.nodes?.length > 0) {
          node = config.proxyNodes?.find(n => n.id === chain.nodes[0]);
        }
      }
      if (!node) return res.json({ success: false, message: 'Node not found' });
      nodesToDial = [node];
    }
    
    const start = Date.now();
    // 使用 Cloudflare 速度测试文件（固定路径，支持 HTTP range，CDN 全球分布）
    const tHost = targetHost || 'speed.cloudflare.com';
    const tPort = targetPort || 443;
    // 下载 5MB 数据用于测速（平衡准确性和响应时间）
    const DOWNLOAD_BYTES = 5 * 1024 * 1024;
    const SPEED_TEST_TIMEOUT_MS = 15000;

    ProxyDialer.dialChain(nodesToDial, tHost, tPort, false, null, (err, socket) => {
      if (err) {
        return res.json({ success: false, message: err.message });
      }

      // 通过代理 socket 发送 HTTPS 请求下载文件
      const tls = require('tls');
      const tlsSocket = tls.connect({
        socket: socket,
        servername: tHost,
        rejectUnauthorized: false
      });

      let totalBytes = 0;
      let responded = false;
      const finish = (errMsg) => {
        if (responded) return;
        responded = true;
        clearTimeout(timeoutHandle);
        tlsSocket.destroy();
        socket.destroy();
        const elapsedMs = Date.now() - start;
        if (errMsg) {
          res.json({ success: false, message: errMsg, latency: elapsedMs });
        } else {
          // 真实速度 = 下载字节数 / 实际下载耗时
          const downloadSeconds = elapsedMs / 1000;
          const speedMBs = downloadSeconds > 0 ? (totalBytes / 1024 / 1024 / downloadSeconds).toFixed(2) : '0';
          res.json({ success: true, speed: speedMBs, bytes: totalBytes, latency: elapsedMs });
        }
      };

      const timeoutHandle = setTimeout(() => finish('测速超时'), SPEED_TEST_TIMEOUT_MS);

      tlsSocket.on('secureConnect', () => {
        // 发送 HTTP GET 请求下载固定大小文件
        const reqPath = `/__down?bytes=${DOWNLOAD_BYTES}`;
        const req = `GET ${reqPath} HTTP/1.1\r\nHost: ${tHost}\r\nConnection: close\r\n\r\n`;
        tlsSocket.write(req);
      });

      tlsSocket.on('data', (chunk) => {
        totalBytes += chunk.length;
      });

      tlsSocket.on('error', (e) => finish(`TLS 错误: ${e.message}`));
      tlsSocket.on('close', () => finish());
      socket.on('error', (e) => finish(`连接错误: ${e.message}`));
      socket.on('close', () => finish());
    });
  });

  // Switch web protocol (HTTP <-> HTTPS) on same port
  app.post('/api/switch-protocol', (req, res) => {
    const { protocol } = req.body;
    if (!['http', 'https'].includes(protocol)) {
      return res.status(400).json({ success: false, message: 'Invalid protocol' });
    }
    const config = configManager.getConfig();
    const oldProtocol = config.webProtocol || 'https';
    if (oldProtocol === protocol) {
      return res.json({ success: true, message: 'Already using ' + protocol, protocol });
    }
    config.webProtocol = protocol;
    configManager.saveConfig(config);
    getLogger().info(`[Service] Switching web protocol to ${protocol.toUpperCase()}, restarting web server...`);
    res.json({ success: true, message: `正在切换到 ${protocol.toUpperCase()}...`, protocol });

    setTimeout(() => {
      // Close both servers
      if (app.locals.server) {
        if (app.locals.server.closeAllConnections) app.locals.server.closeAllConnections();
        app.locals.server.close();
      }
      if (app.locals.httpServer) {
        if (app.locals.httpServer.closeAllConnections) app.locals.httpServer.closeAllConnections();
        app.locals.httpServer.close();
      }
      // Use same restart script approach
      const { writeFileSync } = require('fs');
      const { join } = require('path');
      const os = require('os');
      const cwd = process.cwd();
      let restartScript, runCmd;
      if (process.platform === 'win32') {
        restartScript = join(os.tmpdir(), 'bi-tunnel-restart.bat');
        writeFileSync(restartScript, `@echo off\r\ntimeout /t 3 /nobreak > nul\r\ncd /d "${cwd}"\r\nnpm start\r\n`);
        runCmd = `cmd /c start "" "${restartScript}"`;
      } else {
        restartScript = join(os.tmpdir(), 'bi-tunnel-restart.sh');
        writeFileSync(restartScript, `#!/bin/bash\nsleep 3\ncd "${cwd}"\nnpm start\n`);
        require('fs').chmodSync(restartScript, '755');
        runCmd = `bash "${restartScript}"`;
      }
      const { exec } = require('child_process');
      exec(runCmd, { detached: true, cwd });
      getLogger().info('[Service] Protocol switch script executed, exiting current process...');
      process.exit(0);
    }, 500);
  });

  const port = configManager.getConfig().webPort || 8899;
  const httpPort = configManager.getConfig().webHttpPort || 8898;
  const webProtocol = configManager.getConfig().webProtocol || 'https';
  const certs = getCertificates();
  
  let server, httpServer;
  const WebSocket = require('ws');
  let wss, wssHttp;

  if (webProtocol === 'http') {
    // Main port uses HTTP, secondary port uses HTTPS
    httpServer = http.createServer(app);
    httpServer.listen(port, '0.0.0.0', () => {
      getLogger().info(`Web Control Panel running on http://127.0.0.1:${port}`);
    });
    server = https.createServer({ key: certs.key, cert: certs.cert }, app);
    server.listen(httpPort, '0.0.0.0', () => {
      getLogger().info(`Web Control Panel also available on https://127.0.0.1:${httpPort}`);
    });
    wssHttp = new WebSocket.Server({ server: httpServer });
    wss = new WebSocket.Server({ server });
  } else {
    // Main port uses HTTPS, secondary port uses HTTP (default)
    server = https.createServer({ key: certs.key, cert: certs.cert }, app);
    server.listen(port, '0.0.0.0', () => {
      getLogger().info(`Web Control Panel running securely on https://127.0.0.1:${port}`);
    });
    httpServer = http.createServer(app);
    httpServer.listen(httpPort, '0.0.0.0', () => {
      getLogger().info(`Web Control Panel also available on http://127.0.0.1:${httpPort}`);
    });
    wss = new WebSocket.Server({ server });
    wssHttp = new WebSocket.Server({ server: httpServer });
  }

  app.locals.server = server;
  app.locals.httpServer = httpServer;
  app.locals.wss = wss;

  // Helper: broadcast updated knownClients to all connected WS clients
  const broadcastClientsUpdate = () => {
    const tunnelServer = require('../core/tunnelServer');
    const config = configManager.getConfig();
    const clients = JSON.parse(JSON.stringify(config.server?.knownClients || []));
    clients.forEach(c => {
      c.online = tunnelServer.sessions ? tunnelServer.sessions.has(c.id) : false;
    });
    const msg = JSON.stringify({ type: 'clients_update', data: clients });
    [wss, wssHttp].forEach(ws => {
      ws.clients.forEach(c => {
        if (c.readyState === 1) c.send(msg);
      });
    });
  };
  app.locals.broadcastClientsUpdate = broadcastClientsUpdate;

  const broadcastConnectionsUpdate = () => {
    const tunnelClient = require('../core/tunnelClient');
    const config = configManager.getConfig();
    const connections = JSON.parse(JSON.stringify(config.client?.connections || []));
    const msg2 = JSON.stringify({ type: 'connections_update', data: connections });
    [wss, wssHttp].forEach(ws => {
      ws.clients.forEach(c => {
        if (c.readyState === 1) c.send(msg2);
      });
    });
  };
  app.locals.broadcastConnectionsUpdate = broadcastConnectionsUpdate;

  // 通用 WS 消息广播（用于后端向前端推送错误/状态等）
  app.locals.broadcastWsMessage = (payload) => {
    const msg = JSON.stringify(payload);
    [wss, wssHttp].forEach(ws => {
      ws.clients.forEach(c => {
        if (c.readyState === 1) c.send(msg);
      });
    });
  };

  // Broadcast new traffic logs to subscribed WS clients
  const broadcastTrafficLog = (logEntry) => {
    const msg = JSON.stringify({ type: 'traffic_log', data: logEntry });
    [wss, wssHttp].forEach(ws => {
      ws.clients.forEach(c => {
        // Only push to clients that subscribed to traffic logs
        if (c.readyState === 1 && c._trafficSubscribed) c.send(msg);
      });
    });
  };
  trafficLogger.on('new_log', broadcastTrafficLog);
  app.locals.broadcastTrafficLog = broadcastTrafficLog;

  const handleWsConnection = (ws) => {
    broadcastClientsUpdate();
    broadcastConnectionsUpdate();

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

      // Handle traffic log subscription (no config change needed)
      if (msg.type === 'traffic_subscribe') {
        ws._trafficSubscribed = true;
        return;
      }
      if (msg.type === 'traffic_unsubscribe') {
        ws._trafficSubscribed = false;
        return;
      }

      const currentConfig = configManager.getConfig();
      let changed = false;

      switch (msg.type) {
        case 'client_delete': {
          if (currentConfig.server?.knownClients) {
            currentConfig.server.knownClients = currentConfig.server.knownClients.filter(
              c => c.id !== msg.clientId
            );
            changed = true;
          }
          break;
        }
        case 'client_clear_offline': {
          if (currentConfig.server?.knownClients) {
            const tunnelServer = require('../core/tunnelServer');
            currentConfig.server.knownClients = currentConfig.server.knownClients.filter(
              c => tunnelServer.sessions && tunnelServer.sessions.has(c.id)
            );
            changed = true;
          }
          break;
        }
        case 'server_forward_toggle':
        case 'client_forward_toggle': {
          const mode = msg.type.split('_')[0]; // 'server' or 'client'
          if (currentConfig[mode]?.forwards) {
            const fw = currentConfig[mode].forwards.find(f => f.listenPort === msg.listenPort);
            if (fw) {
              fw.enabled = msg.enabled;
              changed = true;
            }
          }
          break;
        }
        case 'client_connection_toggle': {
          if (currentConfig.client?.connections) {
            const conn = currentConfig.client.connections.find(c => c.id === msg.id);
            if (conn) {
              conn.enabled = msg.enabled;
              changed = true;
            }
          }
          break;
        }
        case 'client_connection_delete': {
          if (currentConfig.client?.connections) {
            currentConfig.client.connections = currentConfig.client.connections.filter(
              c => c.id !== msg.id
            );
            changed = true;
          }
          break;
        }
        case 'client_connection_add': {
          if (!currentConfig.client) currentConfig.client = {};
          if (!currentConfig.client.connections) currentConfig.client.connections = [];
          currentConfig.client.connections.push(msg.connection);
          changed = true;
          break;
        }
      }

      if (changed) {
        configManager.saveConfig(currentConfig);
        getLogger().info(`[WS] Config updated via ${msg.type}`);
        broadcastClientsUpdate();
        broadcastConnectionsUpdate();
        if (app.locals.onConfigSaved) {
          app.locals.onConfigSaved();
        }
      }
    });
  };

  wss.on('connection', handleWsConnection);
  wssHttp.on('connection', handleWsConnection);

  return app;
}

module.exports = { createWebServer };
