const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

const DEFAULT_CONFIG = {
  mode: 'server', // 'server' or 'client'
  webPort: 8899,
  webUsername: 'admin',
  webPassword: 'password',
  logConfig: {
    maxDays: 14,
    maxSizeMB: 20
  },
  server: {
    autoStart: false,
    bindHost: '0.0.0.0',
    tunnelPort: 33891,
    password: 'admin',
    forwards: [],
    proxies: []
  },
  client: {
    autoStart: false,
    tunnelHost: '127.0.0.1',
    tunnelPort: 33891,
    password: 'admin',
    forwards: [],
    proxies: []
  }
};

let currentConfig = { ...DEFAULT_CONFIG };

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf8');
      const loaded = JSON.parse(data);
      // Migration: if loaded has flat config, ignore or clean it up. The user said they don't have much config, so we can just merge.
      if (!loaded.server) loaded.server = { ...DEFAULT_CONFIG.server };
      if (!loaded.client) loaded.client = { ...DEFAULT_CONFIG.client };
      currentConfig = { ...DEFAULT_CONFIG, ...loaded };
      // Delete old flat properties if present
      delete currentConfig.tunnelPort;
      delete currentConfig.bindHost;
      delete currentConfig.tunnelHost;
      delete currentConfig.password;
      delete currentConfig.forwards;
      delete currentConfig.proxies;
    } else {
      saveConfig(currentConfig);
    }
  } catch (err) {
    console.error('Failed to load config:', err);
  }
}

function saveConfig(newConfig) {
  try {
    if (newConfig) {
      currentConfig = { ...currentConfig, ...newConfig };
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(currentConfig, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save config:', err);
  }
}

function getConfig() {
  return currentConfig;
}

module.exports = {
  loadConfig,
  saveConfig,
  getConfig
};
