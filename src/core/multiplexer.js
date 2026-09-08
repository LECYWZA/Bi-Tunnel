const crypto = require('crypto');
const { EventEmitter } = require('events');
const { Duplex } = require('stream');

const TYPE_DATA = 1;
const TYPE_CREATE = 2;
const TYPE_CLOSE = 3;
const TYPE_AUTH = 4;
const TYPE_AUTH_RES = 5;
const TYPE_CREATE_ACK = 6;
const MAX_FRAME_SIZE = 16 * 1024 * 1024;

const AES_ALG = 'aes-256-gcm';
const AES_IV_LEN = 12;
const AES_TAG_LEN = 16;

class MuxChannel extends Duplex {
  constructor(session, id, meta) {
    super();
    this.session = session;
    this.id = id;
    this.meta = meta; // JSON metadata
  }

  _read(size) {
    // We get pushed data
  }

  _write(chunk, encoding, callback) {
    this.session.sendFrame(TYPE_DATA, this.id, chunk, callback);
  }

  _final(callback) {
    this.session.sendFrame(TYPE_CLOSE, this.id, Buffer.alloc(0));
    this.session.channels.delete(this.id);
    callback();
  }

  _destroy(err, callback) {
    try {
      this.session.sendFrame(TYPE_CLOSE, this.id, Buffer.alloc(0));
    } catch (e) {}
    this.session.channels.delete(this.id);
    callback(err);
  }

  pushData(chunk) {
    this.push(chunk);
  }

  remoteClose() {
    this.push(null);
    this.session.channels.delete(this.id);
  }
}

class MuxSession extends EventEmitter {
  constructor(socket, isServer, encryptionKey) {
    super();
    this.socket = socket;
    this.isServer = isServer;
    this.encryptionKey = encryptionKey || null;
    this.channels = new Map();
    this.nextChannelId = isServer ? 2 : 1; // Server uses even, client uses odd
    this.buffer = Buffer.alloc(0);
    this.isAuthenticated = false;

    this.socket.on('data', (data) => this._onData(data));
    this.socket.on('close', () => {
      this._cleanupChannels();
      this.emit('close');
    });
    this.socket.on('error', (err) => {
      this._cleanupChannels(err);
      this.emit('error', err);
    });
  }

  _cleanupChannels(err) {
    for (const channel of this.channels.values()) {
      try {
        if (err) {
          channel.destroy(err);
        } else {
          channel.remoteClose();
        }
      } catch (e) {}
    }
    this.channels.clear();
  }

  _encrypt(plaintext) {
    if (!this.encryptionKey) return plaintext;
    const iv = crypto.randomBytes(AES_IV_LEN);
    const cipher = crypto.createCipheriv(AES_ALG, this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, encrypted, tag]);
  }

  _decrypt(data) {
    if (!this.encryptionKey) return data;
    const iv = data.subarray(0, AES_IV_LEN);
    const tag = data.subarray(data.length - AES_TAG_LEN);
    const encrypted = data.subarray(AES_IV_LEN, data.length - AES_TAG_LEN);
    const decipher = crypto.createDecipheriv(AES_ALG, this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  _onData(data) {
    this.buffer = this.buffer.length === 0 ? data : Buffer.concat([this.buffer, data]);

    let offset = 0;
    while (this.buffer.length - offset >= 9) { // 1(type) + 4(id) + 4(len)
      const type = this.buffer.readUInt8(offset);
      const id = this.buffer.readUInt32BE(offset + 1);
      const len = this.buffer.readUInt32BE(offset + 5);

      if (len > MAX_FRAME_SIZE + AES_IV_LEN + AES_TAG_LEN) {
        this.emit('error', new Error(`Mux frame too large: ${len}`));
        this.close();
        return;
      }

      if (this.buffer.length - offset < 9 + len) {
        break; // Not enough data for payload
      }

      const payload = this.buffer.subarray(offset + 9, offset + 9 + len);
      let decrypted;
      try {
        decrypted = this._decrypt(payload);
      } catch (e) {
        this.emit('error', new Error(`Frame decryption failed: ${e.message}`));
        this.close();
        return;
      }
      this._handleFrame(type, id, decrypted);
      offset += 9 + len;
    }

    // 用 subarray 保留未消费部分，避免每帧 Buffer.slice 拷贝
    if (offset > 0) {
      this.buffer = this.buffer.length === offset ? Buffer.alloc(0) : this.buffer.subarray(offset);
    }
  }

  _handleFrame(type, id, payload) {
    if (type === TYPE_AUTH) {
      const payloadStr = payload.toString('utf8');
      let authData = payloadStr;
      try {
        authData = JSON.parse(payloadStr);
      } catch (e) {
        // Fallback for older clients sending just the password
        authData = { password: payloadStr, clientId: 'legacy-client' };
      }
      // If parsed successfully but lacks clientId, provide a fallback
      if (typeof authData === 'object' && !authData.clientId) {
        authData.clientId = 'legacy-client';
      }
      this.emit('auth', authData);
      return;
    }
    if (type === TYPE_AUTH_RES) {
      const ok = payload.readUInt8(0) === 1;
      if (ok) this.isAuthenticated = true;
      this.emit('auth_res', ok);
      return;
    }

    if (!this.isAuthenticated) {
      return; // Ignore data before auth
    }

    if (type === TYPE_CREATE) {
      const metaStr = payload.toString('utf8');
      let meta = {};
      try { meta = JSON.parse(metaStr); } catch(e){}
      const channel = new MuxChannel(this, id, meta);
      this.channels.set(id, channel);
      this.emit('channel', channel);
    } else if (type === TYPE_DATA) {
      const channel = this.channels.get(id);
      if (channel) channel.pushData(payload);
    } else if (type === TYPE_CLOSE) {
      const channel = this.channels.get(id);
      if (channel) channel.remoteClose();
    } else if (type === TYPE_CREATE_ACK) {
      const channel = this.channels.get(id);
      if (channel) {
        const success = payload.length > 0 && payload.readUInt8(0) === 1;
        channel.emit('ack', success);
        if (!success) {
          channel.remoteClose();
        }
      }
    }
  }

  sendFrame(type, id, payload, callback) {
    if (!payload) payload = Buffer.alloc(0);
    if (!this.socket || this.socket.destroyed) {
      if (callback) callback(new Error('Mux socket is closed'));
      return false;
    }
    if (payload.length > MAX_FRAME_SIZE) {
      const err = new Error(`Mux payload too large: ${payload.length}`);
      if (callback) callback(err);
      else this.emit('error', err);
      return false;
    }
    const encrypted = this._encrypt(payload);
    const header = Buffer.alloc(9);
    header.writeUInt8(type, 0);
    header.writeUInt32BE(id, 1);
    header.writeUInt32BE(encrypted.length, 5);
    const ok = this.socket.write(Buffer.concat([header, encrypted]), callback);
    return ok;
  }

  createChannel(meta) {
    const id = this.nextChannelId;
    this.nextChannelId += 2;
    if (this.nextChannelId > 0xFFFFFFFF) {
      this.nextChannelId = this.isServer ? 2 : 1;
    }
    const metaBuffer = Buffer.from(JSON.stringify(meta), 'utf8');
    this.sendFrame(TYPE_CREATE, id, metaBuffer);
    const channel = new MuxChannel(this, id, meta);
    this.channels.set(id, channel);
    return channel;
  }

  sendAuth(password) {
    this.sendFrame(TYPE_AUTH, 0, Buffer.from(password, 'utf8'));
  }

  sendAuthRes(ok) {
    const payload = Buffer.alloc(1);
    payload.writeUInt8(ok ? 1 : 0, 0);
    this.sendFrame(TYPE_AUTH_RES, 0, payload);
    if (ok) this.isAuthenticated = true;
  }

  close() {
    this.socket.destroy();
  }
}

module.exports = { MuxSession };
