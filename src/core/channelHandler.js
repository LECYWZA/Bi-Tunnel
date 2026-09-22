const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const configManager = require('../config/config');
const { getLogger } = require('../utils/logger');

const MAX_MESSAGES = 500;
const MAX_FILE_RECORDS = 200;
const CHUNK_SIZE = 512 * 1024;

function randomId() {
  return `${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * 消息/文件通道处理器：
 * - 复用 MuxSession 的 createChannel(meta) 机制
 * - meta.type === 'msg'   : 文本消息(正文走 DATA 帧,一次性通道)
 * - meta.type === 'file'  : 文件传输(接收端流式写盘到 files/)
 * - 发送端与接收端均可为服务端或客户端(同一代码,仅 peerId 不同)
 */
class ChannelHandler extends EventEmitter {
  constructor() {
    super();
    this.messages = [];
    this.fileRecords = [];
    this.receiveDir = path.join(process.cwd(), 'files');
    this._sessionRoles = new Map(); // session -> 'server' | 'client'
    this.peers = new Map(); // session -> peerId
    this._ensureDirs();
  }

  _ensureDirs() {
    try {
      fs.mkdirSync(this.receiveDir, { recursive: true });
    } catch (e) {
      getLogger().error(`[Chat] Failed to create receive dir ${this.receiveDir}: ${e.message}`);
    }
  }

  localLabel() {
    const mode = (configManager.getConfig() || {}).mode || 'server';
    return mode === 'server' ? '服务端' : '客户端';
  }

  bindSession(session, peerId, role) {
    this._sessionRoles.set(session, role || 'server');
    this.peers.set(session, peerId || '');
    session.on('channel', (channel) => this._handleChannel(session, peerId, channel));
  }

  _roleOf(session) {
    return this._sessionRoles.get(session) || 'server';
  }

  _handleChannel(session, peerId, channel) {
    const { meta } = channel;
    if (!meta || !meta.type) return;
    if (meta.type === 'msg') {
      this._onMsgChannel(peerId, channel, meta);
    } else if (meta.type === 'file') {
      this._onFileChannel(meta, channel);
    }
  }

  _onMsgChannel(peerId, channel, meta) {
    const chunks = [];
    let text = '';
    const role = this._roleOf(channel.session);
    channel.on('data', (c) => chunks.push(c));
    channel.on('end', () => {
      text = Buffer.concat(chunks).toString('utf8');
      const record = {
        id: meta.id || randomId(),
        ts: meta.ts || Date.now(),
        from: meta.sender || peerId || 'remote',
        to: meta.target || '',
        text,
        dir: 'in',
        via: role
      };
      this.messages.push(record);
      if (this.messages.length > MAX_MESSAGES) {
        this.messages.splice(0, this.messages.length - MAX_MESSAGES);
      }
      getLogger().info(`[Chat] Message received from ${record.from}: ${text.slice(0, 80)}`);
      this.emit('msg', record);
    });
    channel.on('error', () => {});
    channel.on('close', () => {
      // 远端未正常 end 时也尝试收尾
      if (chunks.length > 0 && !text) {
        text = Buffer.concat(chunks).toString('utf8');
        const record = {
          id: meta.id || randomId(),
          ts: meta.ts || Date.now(),
          from: meta.sender || peerId || 'remote',
          to: meta.target || '',
          text,
          dir: 'in',
          via: role
        };
        this.messages.push(record);
        if (this.messages.length > MAX_MESSAGES) this.messages.splice(0, this.messages.length - MAX_MESSAGES);
        this.emit('msg', record);
      }
    });
  }

  _onFileChannel(meta, channel) {
    const role = this._roleOf(channel.session);
    const safeName = path.basename(meta.name || 'file.bin').replace(/[\x00-\x1f]/g, '_');
    const name = safeName || 'file.bin';
    const tmpPath = path.join(this.receiveDir, `.${Date.now().toString(36)}_${meta.id || randomId()}.part`);
    const ws = fs.createWriteStream(tmpPath);
    let received = 0;
    const total = meta.size || 0;

    channel.on('data', (chunk) => {
      received += chunk.length;
      ws.write(chunk);
      this.emit('file_progress', {
        id: meta.id,
        name,
        dir: 'in',
        received,
        total,
        peerId: meta.sender || ''
      });
    });
    channel.on('end', () => {
      ws.end(() => {
        let finalPath = path.join(this.receiveDir, name);
        if (fs.existsSync(finalPath)) {
          const ext = path.extname(name);
          const base = name.slice(0, name.length - ext.length);
          finalPath = path.join(this.receiveDir, `${base}_${Date.now()}${ext}`);
        }
        fs.rename(tmpPath, finalPath, (err) => {
          if (err) {
            getLogger().error(`[Chat] File finalize failed: ${err.message}`);
            return;
          }
          const record = {
            id: meta.id || randomId(),
            ts: meta.ts || Date.now(),
            name,
            size: total || received,
            dir: 'in',
            savedAs: path.basename(finalPath),
            from: meta.sender || '',
            peerId: meta.sender || '',
            via: role
          };
          this.fileRecords.push(record);
          if (this.fileRecords.length > MAX_FILE_RECORDS) {
            this.fileRecords.splice(0, this.fileRecords.length - MAX_FILE_RECORDS);
          }
          getLogger().info(`[Chat] File received: ${name} (${received} bytes) -> ${finalPath}`);
          this.emit('file', record);
        });
      });
    });
    channel.on('error', (err) => {
      getLogger().error(`[Chat] File channel error: ${err.message}`);
      try { ws.destroy(); } catch (e) {}
    });
    channel.on('close', () => {
      // 兜底：被 close 收尾(未触发 end)
      try { ws.end(); } catch (e) {}
    });
  }

  /**
   * 发送文本消息到一组 session(支持服务端多客户端广播,只记账一次)。
   * @returns {{success:boolean, message?:string, record?:object}}
   */
  sendMessageToSessions(sessions, { text, targetId, via }) {
    const id = randomId();
    const ts = Date.now();
    const sender = this.localLabel();
    const meta = { type: 'msg', id, ts, sender, target: targetId || '' };
    let count = 0;
    for (const s of sessions) {
      if (!s || !s.isAuthenticated) continue;
      try {
        const channel = s.createChannel(meta);
        channel.write(Buffer.from(text, 'utf8'));
        channel.end();
        count++;
      } catch (e) {
        getLogger().error(`[Chat] Send message failed: ${e.message}`);
      }
    }
    const record = {
      id,
      ts,
      from: sender,
      to: targetId || '',
      text,
      dir: 'out',
      via: via || 'server'
    };
    this.messages.push(record);
    if (this.messages.length > MAX_MESSAGES) {
      this.messages.splice(0, this.messages.length - MAX_MESSAGES);
    }
    if (count > 0) this.emit('msg', record);
    return {
      success: count > 0,
      count,
      record,
      message: count > 0 ? undefined : '隧道未连接,消息未发送'
    };
  }

  /**
   * 发送文件。filePath 为本地文件路径。
   * @returns {Promise<{success:boolean, message?:string, record?:object}>}
   */
  sendFile(session, { filePath, targetId, via }) {
    return new Promise((resolve) => {
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch (e) {
        return resolve({ success: false, message: `文件不存在: ${filePath}` });
      }
      const id = randomId();
      const ts = Date.now();
      const sender = this.localLabel();
      const name = path.basename(filePath);
      const meta = { type: 'file', id, ts, name, size: stat.size, sender, target: targetId || '' };

      let channel;
      try {
        channel = session.createChannel(meta);
      } catch (e) {
        return resolve({ success: false, message: e.message });
      }

      const record = {
        id,
        ts,
        name,
        size: stat.size,
        dir: 'out',
        to: targetId || '',
        from: sender,
        via: via || 'server'
      };
      this.fileRecords.push(record);
      if (this.fileRecords.length > MAX_FILE_RECORDS) {
        this.fileRecords.splice(0, this.fileRecords.length - MAX_FILE_RECORDS);
      }

      const rs = fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE });
      let sent = 0;
      let finished = false;

      rs.on('data', (chunk) => {
        sent += chunk.length;
        const ok = channel.write(chunk);
        this.emit('file_progress', { id, name, dir: 'out', sent, total: stat.size, peerId: targetId || '' });
        if (!ok) {
          rs.pause();
        }
      });
      channel.on('drain', () => {
        rs.resume();
      });
      rs.on('end', () => {
        if (finished) return;
        finished = true;
        this.emit('file_progress', { id, name, dir: 'out', sent, total: stat.size, peerId: targetId || '' });
        channel.end(() => {
          getLogger().info(`[Chat] File sent: ${name} (${sent} bytes) -> ${targetId || 'peer'}`);
          record.done = true;
          this.emit('file_sent', record);
          resolve({ success: true, record });
        });
      });
      rs.on('error', (err) => {
        if (finished) return;
        finished = true;
        getLogger().error(`[Chat] File send failed: ${err.message}`);
        try { channel.destroy(); } catch (e) {}
        resolve({ success: false, message: err.message });
      });
      channel.on('error', (err) => {
        if (finished) return;
        getLogger().error(`[Chat] File send channel error: ${err.message}`);
        try { rs.destroy(); } catch (e) {}
        resolve({ success: false, message: err.message });
      });
    });
  }

  getMessages() {
    return this.messages;
  }

  getFileRecords() {
    return this.fileRecords;
  }

  listFiles() {
    try {
      const entries = fs.readdirSync(this.receiveDir, { withFileTypes: true });
      const files = [];
      for (const ent of entries) {
        if (!ent.isFile()) continue;
        const p = path.join(this.receiveDir, ent.name);
        try {
          const st = fs.statSync(p);
          files.push({ name: ent.name, size: st.size, mtime: st.mtimeMs });
        } catch (e) {}
      }
      files.sort((a, b) => b.mtime - a.mtime);
      return files;
    } catch (e) {
      return [];
    }
  }
}

module.exports = new ChannelHandler();
