const { EventEmitter } = require('events');

class TrafficLogger extends EventEmitter {
  constructor(maxSize = 2000) {
    super();
    this.maxSize = maxSize;
    this.logs = [];
    this.nextId = 1;
  }

  addLog({ module, sourceIp, target, action, rulePattern = '', bytesTransferred = 0, durationMs = 0, status = 'success', error = '' }) {
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
      error
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
