const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const { URL } = require('url');
const basicAuth = require('express-basic-auth');
const configManager = require('../config/config');
const { getLogger } = require('../utils/logger');
const trafficLogger = require('../utils/trafficLogger');
const { getCertificates } = require('../utils/tlsGenerator');
const { enableSystemProxy, disableSystemProxy } = require('../utils/systemProxy');

// Dependency Injection to get current status
let getStatus = () => ({});

function createWebServer(statusCallback) {
  getStatus = statusCallback || (() => ({}));
  const app = express();
  
  // Basic Auth Middleware
  app.use((req, res, next) => {
    const config = configManager.getConfig();
    const users = {};
    users[config.webUsername || 'admin'] = config.webPassword || 'password';
    
    const authMiddleware = basicAuth({
      users: users,
      challenge: true,
      realm: 'Bi-Tunnel Secure Panel'
    });
    
    authMiddleware(req, res, next);
  });

  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/config', (req, res) => {
    res.json(configManager.getConfig());
  });

  app.post('/api/config', (req, res) => {
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
    res.json(trafficLogger.getLogs(limit, offset));
  });

  app.post('/api/tunnel/:mode/start', (req, res) => {
    const { mode } = req.params;
    if (app.locals.startTunnel) {
      app.locals.startTunnel(mode);
      getLogger().info(`Tunnel started manually via API in mode: ${mode}`);
      res.json({ success: true, message: `Tunnel started in ${mode} mode.` });
    } else {
      res.status(500).json({ success: false, message: 'Tunnel control not bound.' });
    }
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

  app.post('/api/system-proxy/enable', async (req, res) => {
    const { host, port } = req.body;
    if (!port) {
      return res.status(400).json({ success: false, message: 'Port is required' });
    }
    const success = await enableSystemProxy(host || '127.0.0.1', port);
    res.json({ success });
  });

  app.post('/api/system-proxy/disable', async (req, res) => {
    const success = await disableSystemProxy();
    res.json({ success });
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

  const port = configManager.getConfig().webPort || 8899;
  const certs = getCertificates();
  
  const server = https.createServer({
    key: certs.key,
    cert: certs.cert
  }, app);

  server.listen(port, '0.0.0.0', () => {
    getLogger().info(`Web Control Panel running securely on https://127.0.0.1:${port}`);
  });

  return app;
}

module.exports = { createWebServer };
