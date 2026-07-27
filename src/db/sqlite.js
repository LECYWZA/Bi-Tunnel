const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(process.cwd(), 'sqlite.db');

let db = null;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    initTables(db);
  }
  return db;
}

function initTables(dbInstance) {
  // Table for key-value configuration
  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Table for traffic logs
  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS traffic_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      module TEXT,
      source_ip TEXT,
      target TEXT,
      action TEXT,
      rule_pattern TEXT,
      bytes_transferred INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      status TEXT,
      error TEXT,
      client_id TEXT,
      route_path TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_traffic_logs_timestamp ON traffic_logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_traffic_logs_target ON traffic_logs(target);
    CREATE INDEX IF NOT EXISTS idx_traffic_logs_module ON traffic_logs(module);
  `);
}

function closeDb() {
  if (db) {
    try {
      db.close();
    } catch (e) {
      console.error('Failed to close sqlite db:', e);
    }
    db = null;
  }
}

module.exports = {
  getDb,
  closeDb,
  DB_PATH
};
