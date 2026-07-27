const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/sqlite');

class TrafficLogger extends EventEmitter {
  constructor(maxSize = 2000) {
    super();
    this.maxSize = maxSize;
    this.jsonPath = path.join(process.cwd(), 'logs', 'traffic_logs.json');
    this.recordingEnabled = true;
    this.pendingInserts = [];
    this.flushTimer = null;
    this.flushIntervalMs = 100;
    this._migrated = false;
  }

  setEnabled(enabled) {
    this.recordingEnabled = !!enabled;
  }

  isEnabled() {
    return this.recordingEnabled;
  }

  migrateOldJsonLogs() {
    try {
      if (fs.existsSync(this.jsonPath)) {
        const data = fs.readFileSync(this.jsonPath, 'utf8');
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const db = getDb();
          const insertStmt = db.prepare(`
            INSERT INTO traffic_logs (timestamp, module, source_ip, target, action, rule_pattern, bytes_transferred, duration_ms, status, error, client_id, route_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          
          const insertMany = db.transaction((logs) => {
            for (const l of logs) {
              const routePathStr = Array.isArray(l.routePath) ? JSON.stringify(l.routePath) : (l.routePath || '');
              insertStmt.run(
                l.timestamp || Date.now(),
                l.module || '',
                l.sourceIp || 'Local',
                l.target || '',
                l.action || '',
                l.rulePattern || '',
                l.bytesTransferred || 0,
                l.durationMs || 0,
                l.status || 'success',
                l.error || '',
                l.clientId || '',
                routePathStr
              );
            }
          });

          insertMany(parsed);
        }
        
        try {
          fs.renameSync(this.jsonPath, this.jsonPath + '.bak');
        } catch (e) {}
      }
    } catch (err) {
      console.error('Failed to migrate old traffic logs to sqlite:', err);
    }
  }

  flushPending() {
    if (this.pendingInserts.length === 0) return;
    const itemsToFlush = this.pendingInserts;
    this.pendingInserts = [];
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    try {
      const db = getDb();
      const insertStmt = db.prepare(`
        INSERT INTO traffic_logs (timestamp, module, source_ip, target, action, rule_pattern, bytes_transferred, duration_ms, status, error, client_id, route_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertMany = db.transaction((logs) => {
        for (const item of logs) {
          const routePathStr = Array.isArray(item.routePath) ? JSON.stringify(item.routePath) : (item.routePath || '');
          const info = insertStmt.run(
            item.timestamp,
            item.module || '',
            item.sourceIp || 'Local',
            item.target || '',
            item.action || '',
            item.rulePattern || '',
            item.bytesTransferred || 0,
            item.durationMs || 0,
            item.status || 'success',
            item.error || '',
            item.clientId || '',
            routePathStr
          );
          item.id = Number(info.lastInsertRowid);
        }
      });

      insertMany(itemsToFlush);
      this.cleanLogs(db);
    } catch (err) {
      console.error('Failed to flush traffic logs to sqlite:', err);
    }
  }

  scheduleFlush() {
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flushPending();
      }, this.flushIntervalMs);
    }
  }

  cleanLogs(dbInstance) {
    try {
      const db = dbInstance || getDb();
      // Count-based cleanup
      const pruneStmt = db.prepare(`
        DELETE FROM traffic_logs WHERE id NOT IN (
          SELECT id FROM traffic_logs ORDER BY id DESC LIMIT ?
        )
      `);
      pruneStmt.run(this.maxSize);

      // TTL Time-based cleanup if maxDays configured
      let maxDays = 14;
      try {
        const configManager = require('../config/config');
        const cfg = configManager.getConfig();
        if (cfg && cfg.logConfig && cfg.logConfig.maxDays) {
          maxDays = cfg.logConfig.maxDays;
        }
      } catch (e) {
        console.error('Failed to load config for log cleanup:', e.message);
      }

      if (maxDays > 0) {
        const minTimestamp = Date.now() - (maxDays * 86400 * 1000);
        const ttlStmt = db.prepare('DELETE FROM traffic_logs WHERE timestamp < ?');
        ttlStmt.run(minTimestamp);
      }
    } catch (err) {
      console.error('Failed to clean traffic logs:', err);
    }
  }

  saveSync() {
    this.flushPending();
  }

  scheduleSave() {
    this.scheduleFlush();
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
    if (!this.recordingEnabled) return null;

    if (!this._migrated) {
      this._migrated = true;
      this.migrateOldJsonLogs();
    }

    const timestamp = Date.now();
    const resolvedRoutePath = routePath || this.resolveRoutePath(action, target);

    const logEntry = {
      id: null,
      timestamp,
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
      routePath: resolvedRoutePath
    };

    this.pendingInserts.push(logEntry);
    this.emit('new_log', logEntry);
    this.scheduleFlush();

    if (this.pendingInserts.length >= 100) {
      this.flushPending();
    }

    return logEntry;
  }

  updateLog(logEntry) {
    if (!logEntry) return;
    if (logEntry.id) {
      try {
        const db = getDb();
        const updateStmt = db.prepare(`
          UPDATE traffic_logs
          SET bytes_transferred = ?, duration_ms = ?, status = ?, error = ?
          WHERE id = ?
        `);
        updateStmt.run(
          logEntry.bytesTransferred || 0,
          logEntry.durationMs || 0,
          logEntry.status || 'success',
          logEntry.error || '',
          logEntry.id
        );
      } catch (err) {
        console.error('Failed to update traffic log in sqlite:', err);
      }
    } else if (this.pendingInserts && this.pendingInserts.length > 0) {
      const pending = this.pendingInserts.find(item => item === logEntry);
      if (pending) {
        pending.bytesTransferred = logEntry.bytesTransferred || 0;
        pending.durationMs = logEntry.durationMs || 0;
        pending.status = logEntry.status || 'success';
        pending.error = logEntry.error || '';
      }
    }
  }

  getLogs(limit = 100, offset = 0, query = {}) {
    if (!this._migrated) {
      this._migrated = true;
      this.migrateOldJsonLogs();
    }
    this.flushPending(); // Ensure all buffered logs are in DB before querying
    try {
      const conditions = [];
      const params = [];

      if (query.target) {
        conditions.push('LOWER(target) LIKE ?');
        params.push(`%${query.target.toLowerCase()}%`);
      }
      if (query.module) {
        conditions.push('module LIKE ?');
        params.push(`%${query.module}%`);
      }
      if (query.action) {
        conditions.push('action = ?');
        params.push(query.action);
      }
      if (query.clientId) {
        conditions.push('client_id = ?');
        params.push(query.clientId);
      }
      if (query.sourceIp) {
        conditions.push('LOWER(source_ip) LIKE ?');
        params.push(`%${query.sourceIp.toLowerCase()}%`);
      }
      if (query.status) {
        conditions.push('status = ?');
        params.push(query.status);
      }
      if (query.rulePattern) {
        conditions.push('LOWER(rule_pattern) LIKE ?');
        params.push(`%${query.rulePattern.toLowerCase()}%`);
      }

      const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

      const db = getDb();
      const countStmt = db.prepare(`SELECT COUNT(*) as count FROM traffic_logs ${whereClause}`);
      const totalResult = countStmt.get(...params);
      const total = totalResult ? totalResult.count : 0;

      const logsStmt = db.prepare(`
        SELECT id, timestamp, module, source_ip as sourceIp, target, action, rule_pattern as rulePattern,
               bytes_transferred as bytesTransferred, duration_ms as durationMs, status, error,
               client_id as clientId, route_path as routePath
        FROM traffic_logs ${whereClause}
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `);
      const rows = logsStmt.all(...params, limit, offset);

      const logs = rows.map(r => {
        let parsedRoutePath = r.routePath;
        if (typeof r.routePath === 'string' && r.routePath.startsWith('[')) {
          try { parsedRoutePath = JSON.parse(r.routePath); } catch (e) {}
        }
        return {
          ...r,
          routePath: parsedRoutePath
        };
      });

      return { total, logs };
    } catch (err) {
      console.error('Failed to get traffic logs from sqlite:', err);
      return { total: 0, logs: [] };
    }
  }

  clear() {
    this.pendingInserts = [];
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    try {
      const db = getDb();
      db.prepare('DELETE FROM traffic_logs').run();
    } catch (err) {
      console.error('Failed to clear traffic logs in sqlite:', err);
    }
  }
}

module.exports = new TrafficLogger();
