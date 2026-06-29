const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

class TrafficLogger extends EventEmitter {
  constructor(maxSize = 2000) {
    super();
    this.maxSize = maxSize;
    this.logs = [];
    this.nextId = 1;
    this.filePath = path.join(process.cwd(), 'logs', 'traffic_logs.json');
    this.saveTimer = null;
    this.recordingEnabled = true;
    this.loadLogs();
  }

  setEnabled(enabled) {
    this.recordingEnabled = !!enabled;
  }

  isEnabled() {
    return this.recordingEnabled;
  }

  loadLogs() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          this.logs = parsed.slice(0, this.maxSize);
          let maxId = 0;
          for (const log of this.logs) {
            if (log.id && log.id > maxId) {
              maxId = log.id;
            }
          }
          this.nextId = maxId + 1;
        }
      }
    } catch (err) {
      console.error('Failed to load traffic logs from disk:', err);
    }
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(this.filePath, JSON.stringify(this.logs, null, 2), 'utf8');
      } catch (err) {
        console.error('Failed to save traffic logs to disk:', err);
      }
    }, 1000); // Save at most once per second
  }

  saveSync() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.logs, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to save traffic logs synchronously:', err);
    }
  }

  resolveRoutePath(action, target) {
    const pathArr = ['本机'];
    if (!action) {
      pathArr.push(target);
      return pathArr;
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
            pathArr.push(node ? (node.displayName || node.name || node.host) : ref);
          }
        } else {
          pathArr.push(`链:${chainId}`);
        }
      } else {
        pathArr.push(`链:${chainId}`);
      }
    } else if (action.startsWith('node:')) {
      const nodeId = action.substring(5);
      if (globalConfig) {
        const node = globalConfig.proxyNodes?.find(n => n.id === nodeId);
        pathArr.push(node ? (node.displayName || node.name || node.host) : nodeId);
      } else {
        pathArr.push(`节点:${nodeId}`);
      }
    } else if (action === 'direct_remote') {
      pathArr.push('隧道');
    } else if (action === 'direct' || action === 'direct_local') {
      pathArr.push('直连');
    } else if (action === 'forward') {
      pathArr.push('隧道转发');
    } else if (action === 'reverse_forward') {
      return ['隧道反向代理', '本机', target];
    } else if (action === 'block') {
      return ['本机', '拦截', target];
    } else {
      pathArr.push(action);
    }

    pathArr.push(target);
    return pathArr;
  }

  addLog({ module, sourceIp, target, action, rulePattern = '', bytesTransferred = 0, durationMs = 0, status = 'success', error = '', clientId = '', routePath }) {
    // If recording is disabled, do not store or emit anything
    if (!this.recordingEnabled) return null;

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
      routePath: routePath || this.resolveRoutePath(action, target)
    };

    this.logs.unshift(logEntry);

    // Keep ring buffer size
    if (this.logs.length > this.maxSize) {
      this.logs.pop();
    }

    this.emit('new_log', logEntry);
    this.scheduleSave();
    return logEntry;
  }

  updateLog(logEntry) {
    // Just schedule save since the logEntry is updated in-place by reference
    this.scheduleSave();
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
    if (query.sourceIp) {
      const q = query.sourceIp.toLowerCase();
      filteredLogs = filteredLogs.filter(l => l.sourceIp && l.sourceIp.toLowerCase().includes(q));
    }
    if (query.status) {
      filteredLogs = filteredLogs.filter(l => l.status === query.status);
    }
    if (query.rulePattern) {
      const q = query.rulePattern.toLowerCase();
      filteredLogs = filteredLogs.filter(l => l.rulePattern && l.rulePattern.toLowerCase().includes(q));
    }

    return {
      total: filteredLogs.length,
      logs: filteredLogs.slice(offset, offset + limit)
    };
  }

  clear() {
    this.logs = [];
    this.scheduleSave();
  }
}

module.exports = new TrafficLogger();
