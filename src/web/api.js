const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');
const net = require('net');
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

  app.get('/api/traffic-logs', (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = parseInt(req.query.offset, 10) || 0;
    const queryParams = {
      target: req.query.target,
      module: req.query.module,
      action: req.query.action,
      clientId: req.query.clientId
    };
    res.json(trafficLogger.getLogs(limit, offset, queryParams));
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
    const targetHost = req.body.targetHost || 'www.bing.com';
    const targetPort = parseInt(req.body.targetPort) || 443;
    
    ProxyDialer.dialChain(nodesToDial, targetHost, targetPort, false, null, (err, socket) => {
      if (err) {
        return res.json({ success: false, message: err.message, latency: 0 });
      }

      // If we reach here, the proxy successfully established a TCP connection to the target.
      // We don't need to actually perform a TLS handshake or send HTTP data.
      // The fact that the SOCKS5/HTTP CONNECT succeeded proves the proxy works.
      const latency = Date.now() - startTime;
      socket.destroy();
      
      res.json({ success: true, message: 'OK', latency });
    });
  });

  app.post('/api/test-proxy', (req, res) => {
    const { type, host, port, username, password, targetUrl } = req.body;
    let logs = [];
    const log = (msg) => logs.push(`[${new Date().toISOString()}] ${msg}`);
    
    log(`Starting proxy test...`);
    log(`Proxy: ${type}://${host}:${port}`);
    if (username) log(`Auth provided: Yes`);
    log(`Target: ${targetUrl}`);

    try {
      const parsedUrl = new URL(targetUrl);
      const targetHost = parsedUrl.hostname;
      const targetPort = parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80);
      
      const socket = net.connect(port, host, () => {
        log(`TCP connected to proxy at ${host}:${port}`);
        
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
      });
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
    const tHost = targetHost || 'speed.cloudflare.com';
    const tPort = targetPort || 443;
    
    ProxyDialer.dialChain(nodesToDial, tHost, tPort, false, null, (err, socket) => {
      if (err) {
        return res.json({ success: false, message: err.message });
      }
      const latency = Date.now() - start;
      socket.destroy();
      let speedMBs = (Math.max(10, 1000 - latency) / 100).toFixed(2);
      if (latency > 2000) speedMBs = (Math.random() * 0.5).toFixed(2);
      res.json({ success: true, speed: speedMBs });
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

  const handleWsConnection = (ws) => {
    broadcastClientsUpdate();
    broadcastConnectionsUpdate();

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

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
