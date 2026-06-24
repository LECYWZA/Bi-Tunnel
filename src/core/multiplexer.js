const { EventEmitter } = require('events');
const { Duplex } = require('stream');

const TYPE_DATA = 1;
const TYPE_CREATE = 2;
const TYPE_CLOSE = 3;
const TYPE_AUTH = 4;
const TYPE_AUTH_RES = 5;

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
    this.session.sendFrame(TYPE_DATA, this.id, chunk);
    callback();
  }

  _final(callback) {
    this.session.sendFrame(TYPE_CLOSE, this.id, Buffer.alloc(0));
    this.session.channels.delete(this.id);
    callback();
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
  constructor(socket, isServer) {
    super();
    this.socket = socket;
    this.isServer = isServer;
    this.channels = new Map();
    this.nextChannelId = isServer ? 2 : 1; // Server uses even, client uses odd
    this.buffer = Buffer.alloc(0);
    this.isAuthenticated = false;

    this.socket.on('data', (data) => this._onData(data));
    this.socket.on('close', () => this.emit('close'));
    this.socket.on('error', (err) => this.emit('error', err));
  }

  _onData(data) {
    this.buffer = Buffer.concat([this.buffer, data]);

    while (this.buffer.length >= 9) { // 1(type) + 4(id) + 4(len)
      const type = this.buffer.readUInt8(0);
      const id = this.buffer.readUInt32BE(1);
      const len = this.buffer.readUInt32BE(5);

      if (this.buffer.length < 9 + len) {
        break; // Not enough data for payload
      }

      const payload = this.buffer.slice(9, 9 + len);
      this.buffer = this.buffer.slice(9 + len);
      this._handleFrame(type, id, payload);
    }
  }

  _handleFrame(type, id, payload) {
    if (type === TYPE_AUTH) {
      this.emit('auth', payload.toString('utf8'));
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
    }
  }

  sendFrame(type, id, payload) {
    const header = Buffer.alloc(9);
    header.writeUInt8(type, 0);
    header.writeUInt32BE(id, 1);
    header.writeUInt32BE(payload.length, 5);
    this.socket.write(Buffer.concat([header, payload]));
  }

  createChannel(meta) {
    const id = this.nextChannelId;
    this.nextChannelId += 2;
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
