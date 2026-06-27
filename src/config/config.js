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
  proxyNodes: [],
  proxyChains: [],
  ruleCards: [],
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
      if (!loaded.proxyNodes) loaded.proxyNodes = [];
      if (!loaded.proxyChains) loaded.proxyChains = [];
      if (!loaded.ruleCards) loaded.ruleCards = [];
      
      // Upgrade existing proxyChains to use nodeRefs
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
                nodeRefs.push(node); // already a ref
              }
            });
            chain.nodes = nodeRefs; // replace full objects with refs
          }
        });
      }

      // Upgrade existing inline chainNodes to decoupled proxyChains if any exist
      if (loaded.server && loaded.server.proxies) {
        loaded.server.proxies.forEach(px => migrateInlineChain(px, loaded));
        loaded.server.proxies.forEach(px => migrateProxyRulesToCards(px, loaded));
      }
      if (loaded.client && loaded.client.proxies) {
        loaded.client.proxies.forEach(px => migrateInlineChain(px, loaded));
        loaded.client.proxies.forEach(px => migrateProxyRulesToCards(px, loaded));
      }

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
    // Update rules that point to proxy_chain
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
      // Ensure action is an array
      if (rule.action && !Array.isArray(rule.action)) {
        rule.action = [rule.action];
      }
      
      // Migrate pattern to a shared rule card
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
    });
  }
  if (px.defaultRuleAction && !Array.isArray(px.defaultRuleAction)) {
    px.defaultRuleAction = [px.defaultRuleAction];
  }
}

module.exports = {
  loadConfig,
  saveConfig,
  getConfig
};
