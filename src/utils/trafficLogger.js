const { EventEmitter } = require('events');

class TrafficLogger extends EventEmitter {
  constructor(maxSize = 2000) {
    super();
    this.maxSize = maxSize;
    this.logs = [];
    this.nextId = 1;
  }

  addLog({ module, sourceIp, target, action, bytesTransferred = 0, durationMs = 0, status = 'success', error = '' }) {
    const logEntry = {
      id: this.nextId++,
      timestamp: Date.now(),
      module,
      sourceIp: sourceIp || 'Local',
      target,
      action,
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

  getLogs(limit = 100, offset = 0) {
    return {
      total: this.logs.length,
      logs: this.logs.slice(offset, offset + limit)
    };
  }

  clear() {
    this.logs = [];
  }
}

module.exports = new TrafficLogger();
