const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const basicAuth = require('express-basic-auth');
const configManager = require('../config/config');
const { getLogger } = require('../utils/logger');
const { getCertificates } = require('../utils/tlsGenerator');

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
