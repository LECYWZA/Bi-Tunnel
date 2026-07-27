const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/sqlite');

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

const DEFAULT_CONFIG = {
  mode: 'server', // 'server' or 'client'
  webPort: 8899,
  webUsername: 'admin',
  webPassword: 'password',
  secretToken: '',
  logConfig: {
    maxDays: 14,
    maxSizeMB: 20
  },
  proxyNodes: [],
  proxyChains: [],
  ruleCards: [],
  routerSystem: {
    enabled: false,
    name: 'bi-router',
    interface: '',
    subnetCidr: '192.168.88.1/24',
    upstreamMode: 'direct', // direct | systemProxy | tun | proxy
    upstreamProxyId: '',
    dhcp: {
      enabled: true,
      rangeStart: '192.168.88.100',
      rangeEnd: '192.168.88.200',
      leaseTimeHours: 24,
      gateway: '192.168.88.1'
    },
    macFilter: {
      mode: 'disabled', // disabled | whitelist | blacklist
      addresses: []
    },
    staticBindings: [],
    devices: []
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

function mergeDefaults(defaultValue, loadedValue) {
  if (Array.isArray(defaultValue)) {
    return Array.isArray(loadedValue) ? loadedValue : [...defaultValue];
  }
  if (defaultValue && typeof defaultValue === 'object') {
    const result = { ...defaultValue };
    if (loadedValue && typeof loadedValue === 'object' && !Array.isArray(loadedValue)) {
      for (const key of Object.keys(loadedValue)) {
        result[key] = key in defaultValue
          ? mergeDefaults(defaultValue[key], loadedValue[key])
          : loadedValue[key];
      }
    }
    return result;
  }
  return loadedValue === undefined ? defaultValue : loadedValue;
}

let currentConfig = mergeDefaults(DEFAULT_CONFIG, {});

function saveConfigToDb(configObj, dbInstance) {
  const db = dbInstance || getDb();
  const stmt = db.prepare(`
    INSERT INTO system_config (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);

  const sections = {
    'section:global': {
      mode: configObj.mode,
      webPort: configObj.webPort,
      webUsername: configObj.webUsername,
      webPassword: configObj.webPassword,
      secretToken: configObj.secretToken,
      logConfig: configObj.logConfig,
      tunModeEnabled: configObj.tunModeEnabled,
      tunProxyPort: configObj.tunProxyPort,
      globalProxyEnabled: configObj.globalProxyEnabled,
      globalProxyPort: configObj.globalProxyPort,
      webProtocol: configObj.webProtocol,
      webHttpPort: configObj.webHttpPort
    },
    'section:proxyNodes': configObj.proxyNodes || [],
    'section:proxyChains': configObj.proxyChains || [],
    'section:ruleCards': configObj.ruleCards || [],
    'section:routerSystem': configObj.routerSystem || {},
    'section:server': configObj.server || {},
    'section:client': configObj.client || {}
  };

  const saveBatch = db.transaction((secMap) => {
    const now = Date.now();
    for (const [k, val] of Object.entries(secMap)) {
      const jsonVal = JSON.stringify(val) || 'null';
      stmt.run(k, jsonVal, now);
    }
  });

  saveBatch(sections);
}

function loadConfig() {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT key, value FROM system_config WHERE key LIKE 'section:%' OR key = 'config'").all();
    const secMap = {};
    for (const row of rows) {
      try {
        secMap[row.key] = JSON.parse(row.value);
      } catch (e) {}
    }

    let loaded = null;

    if (secMap['section:global']) {
      loaded = {
        ...secMap['section:global'],
        proxyNodes: secMap['section:proxyNodes'] || [],
        proxyChains: secMap['section:proxyChains'] || [],
        ruleCards: secMap['section:ruleCards'] || [],
        routerSystem: secMap['section:routerSystem'] || {},
        server: secMap['section:server'] || {},
        client: secMap['section:client'] || {}
      };
    } else if (secMap['config']) {
      loaded = secMap['config'];
    } else if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf8');
      loaded = JSON.parse(data);
      saveConfigToDb(loaded, db);
      try {
        fs.renameSync(CONFIG_PATH, CONFIG_PATH + '.bak');
      } catch (e) {}
    }

    if (loaded) {
      if (!loaded.server) loaded.server = { ...DEFAULT_CONFIG.server };
      if (!loaded.client) loaded.client = { ...DEFAULT_CONFIG.client };
      if (!loaded.proxyNodes) loaded.proxyNodes = [];
      if (!loaded.proxyChains) loaded.proxyChains = [];
      if (!loaded.ruleCards) loaded.ruleCards = [];
      if (!loaded.routerSystem) loaded.routerSystem = { ...DEFAULT_CONFIG.routerSystem };
      else {
        const def = DEFAULT_CONFIG.routerSystem;
        const rs = loaded.routerSystem;
        rs.enabled = !!rs.enabled;
        rs.name = rs.name || def.name;
        rs.interface = rs.interface || def.interface;
        rs.subnetCidr = rs.subnetCidr || def.subnetCidr;
        rs.upstreamMode = rs.upstreamMode || def.upstreamMode;
        rs.upstreamProxyId = rs.upstreamProxyId || '';
        rs.dhcp = Object.assign({}, def.dhcp, rs.dhcp || {});
        rs.macFilter = Object.assign({}, def.macFilter, rs.macFilter || {});
        if (!Array.isArray(rs.staticBindings)) rs.staticBindings = [];
        if (!Array.isArray(rs.devices)) rs.devices = [];
      }
      
      if (loaded.proxyChains.length > 0) {
        loaded.proxyChains.forEach(chain => {
          if (chain.nodes && Array.isArray(chain.nodes)) {
            const nodeRefs = [];
            chain.nodes.forEach(node => {
              if (typeof node === 'object' && node.type) {
                const nodeId = 'node_' + Math.random().toString(36).substr(2, 9);
                node.id = nodeId;
                if (!node.displayName) node.displayName = `${node.type.toUpperCase()} Node`;
                loaded.proxyNodes.push(node);
                nodeRefs.push(nodeId);
              } else if (typeof node === 'string') {
                nodeRefs.push(node);
              }
            });
            chain.nodes = nodeRefs;
          }
        });
      }

      if (loaded.server && loaded.server.proxies) {
        loaded.server.proxies.forEach(px => migrateInlineChain(px, loaded));
        loaded.server.proxies.forEach(px => migrateProxyRulesToCards(px, loaded));
      }
      if (loaded.client && loaded.client.proxies) {
        loaded.client.proxies.forEach(px => migrateInlineChain(px, loaded));
        loaded.client.proxies.forEach(px => migrateProxyRulesToCards(px, loaded));
      }

      [loaded.server, loaded.client].forEach(side => {
        if (side && side.proxies) {
          side.proxies.forEach(px => {
            if (px.useAuth === undefined) px.useAuth = false;
            if (!px.users) px.users = [{ user: '', pass: '' }];
          });
        }
      });

      currentConfig = mergeDefaults(DEFAULT_CONFIG, loaded);
      delete currentConfig.tunnelPort;
      delete currentConfig.bindHost;
      delete currentConfig.tunnelHost;
      delete currentConfig.password;
      delete currentConfig.forwards;
      delete currentConfig.proxies;

      // Re-save to DB to ensure section keys are initialized
      saveConfigToDb(currentConfig, db);
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
      // Deep merge: newConfig fields override currentConfig, missing fields preserved
      currentConfig = mergeDefaults(DEFAULT_CONFIG, mergeDefaults(currentConfig, newConfig));
    }
    saveConfigToDb(currentConfig);
  } catch (err) {
    console.error('Failed to save config:', err);
  }
}

function getConfig() {
  return currentConfig;
}

function migrateInlineChain(px, loaded) {
  if (px.chainNodes && px.chainNodes.length > 0) {
    const chainId = 'chain_' + Math.random().toString(36).substr(2, 9);
    const nodeRefs = [];
    px.chainNodes.forEach(node => {
      const nodeId = 'node_' + Math.random().toString(36).substr(2, 9);
      node.id = nodeId;
      if (!node.displayName) node.displayName = `${node.type.toUpperCase()} Node`;
      loaded.proxyNodes.push(node);
      nodeRefs.push(nodeId);
    });

    loaded.proxyChains.push({
      id: chainId,
      name: `Migrated Chain (Port ${px.listenPort})`,
      nodes: nodeRefs
    });
    if (px.proxyRules) {
      px.proxyRules.forEach(r => {
        if (r.action === 'proxy_chain') {
          r.action = 'chain:' + chainId;
        }
      });
    }
    if (px.defaultRuleAction === 'proxy_chain') {
      px.defaultRuleAction = 'chain:' + chainId;
    }
    delete px.chainNodes;
  }
}

function migrateProxyRulesToCards(px, loaded) {
  if (px.proxyRules && Array.isArray(px.proxyRules)) {
    if (!loaded.ruleCards) loaded.ruleCards = [];
    px.proxyRules.forEach((rule, idx) => {
      if (rule.action && !Array.isArray(rule.action)) {
        rule.action = [rule.action];
      }

      if (rule.pattern && !rule.ruleCardId && !rule.ruleCardIds) {
        const cardId = 'rule_card_' + Math.random().toString(36).substr(2, 9);
        const cardName = `${px.name || ('端口 ' + px.listenPort)} - 规则 ${idx + 1}`;
        const patterns = Array.isArray(rule.pattern) ? rule.pattern : [rule.pattern];
        loaded.ruleCards.push({
          id: cardId,
          name: cardName,
          patterns: patterns
        });
        rule.ruleCardIds = [cardId];
        delete rule.pattern;
      } else if (rule.ruleCardId && !rule.ruleCardIds) {
        rule.ruleCardIds = [rule.ruleCardId];
        delete rule.ruleCardId;
      }

      if (!rule.networkMode) rule.networkMode = 'local';
      if (!rule.targetClientId) rule.targetClientId = '';
    });
  }
  if (px.defaultRuleAction && !Array.isArray(px.defaultRuleAction)) {
    px.defaultRuleAction = [px.defaultRuleAction];
  }
  if (Array.isArray(px.defaultRuleAction) && !px.defaultRuleActions) {
    px.defaultRuleActions = px.defaultRuleAction.map(act => ({
      action: act,
      networkMode: act === 'direct_remote' ? 'remote' : 'local',
      targetClientId: ''
    }));
    delete px.defaultRuleAction;
  } else if (px.defaultRuleActions) {
    px.defaultRuleActions.forEach(item => {
      if (!item.networkMode) item.networkMode = item.action === 'direct_remote' ? 'remote' : 'local';
      if (!item.targetClientId) item.targetClientId = '';
      if (item.action === 'direct_remote' && item.networkMode === 'local') {
        item.networkMode = 'remote';
      }
    });
  }
}

module.exports = {
  loadConfig,
  saveConfig,
  getConfig
};
