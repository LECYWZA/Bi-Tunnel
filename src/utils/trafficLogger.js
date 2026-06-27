const { EventEmitter } = require('events');

class TrafficLogger extends EventEmitter {
  constructor(maxSize = 2000) {
    super();
    this.maxSize = maxSize;
    this.logs = [];
    this.nextId = 1;
  }

  resolveRoutePath(action, target) {
    const path = ['本机'];
    if (!action) {
      path.push(target);
      return path;
    }

    let globalConfig;
    try {
      const configManager = require('../config/config');
      globalConfig = configManager.getConfig();
    } catch (e) {
      // Ignore config load error
    }

    if (action.startsWith('chain:')) {
      const chainId = action.substring(6);
      if (globalConfig) {
        const chain = globalConfig.proxyChains?.find(c => c.id === chainId);
        if (chain && chain.nodes) {
          for (const ref of chain.nodes) {
            const node = globalConfig.proxyNodes?.find(n => n.id === ref);
            path.push(node ? (node.displayName || node.name || node.host) : ref);
          }
        } else {
          path.push(`链:${chainId}`);
        }
      } else {
        path.push(`链:${chainId}`);
      }
    } else if (action.startsWith('node:')) {
      const nodeId = action.substring(5);
      if (globalConfig) {
        const node = globalConfig.proxyNodes?.find(n => n.id === nodeId);
        path.push(node ? (node.displayName || node.name || node.host) : nodeId);
      } else {
        path.push(`节点:${nodeId}`);
      }
    } else if (action === 'direct_remote') {
      path.push('隧道');
    } else if (action === 'direct' || action === 'direct_local') {
      path.push('直连');
    } else if (action === 'forward') {
      path.push('隧道转发');
    } else if (action === 'reverse_forward') {
      return ['隧道反向代理', '本机', target];
    } else if (action === 'block') {
      return ['本机', '拦截', target];
    } else {
      path.push(action);
    }

    path.push(target);
    return path;
  }

  addLog({ module, sourceIp, target, action, rulePattern = '', bytesTransferred = 0, durationMs = 0, status = 'success', error = '', clientId = '' }) {
    const logEntry = {
      id: this.nextId++,
      timestamp: Date.now(),
      module,
      sourceIp: sourceIp || 'Local',
      target,
      action,
      rulePattern,
      bytesTransferred,
      durationMs,
      status,
      error,
      clientId,
      routePath: this.resolveRoutePath(action, target)
    };

    this.logs.unshift(logEntry);

    // Keep ring buffer size
    if (this.logs.length > this.maxSize) {
      this.logs.pop();
    }

    this.emit('new_log', logEntry);
  }

  getLogs(limit = 100, offset = 0, query = {}) {
    let filteredLogs = this.logs;
    
    if (query.target) {
      const q = query.target.toLowerCase();
      filteredLogs = filteredLogs.filter(l => l.target && l.target.toLowerCase().includes(q));
    }
    if (query.module) {
      filteredLogs = filteredLogs.filter(l => l.module && l.module.includes(query.module));
    }
    if (query.action) {
      filteredLogs = filteredLogs.filter(l => l.action === query.action);
    }
    if (query.clientId) {
      filteredLogs = filteredLogs.filter(l => l.clientId === query.clientId);
    }

    return {
      total: filteredLogs.length,
      logs: filteredLogs.slice(offset, offset + limit)
    };
  }

  clear() {
    this.logs = [];
  }
}

module.exports = new TrafficLogger();
