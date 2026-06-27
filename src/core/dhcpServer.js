const dgram = require('dgram');
const os = require('os');
const { getLogger } = require('../utils/logger');

/**
 * 纯 Node.js 实现的极简 DHCP 服务器（UDP 67）
 * 仅支持 IPv4、DISCOVER/OFFER/REQUEST/ACK/NAK 标准流程
 *
 * 依赖外部注入：
 *  - config: { rangeStart, rangeEnd, leaseTimeMs, gateway, dns[], serverIp, interfaceIp }
 *  - registry: 见 deviceRegistry.js
 *    - getLease(mac) -> { ip, mac, hostname, expiresAt, enabled } | null
 *  - onEvent(type, payload) -> 用于通知 deviceRegistry 更新
 */

// DHCP 消息类型
const MSG_DISCOVER = 1;
const MSG_OFFER = 2;
const MSG_REQUEST = 3;
const MSG_DECLINE = 4;
const MSG_ACK = 5;
const MSG_NAK = 6;
const MSG_RELEASE = 7;
const MSG_INFORM = 8;

// DHCP 选项码
const OPT_SUBNET_MASK = 1;
const OPT_ROUTER = 3;
const OPT_DNS = 6;
const OPT_LEASE_TIME = 51;
const OPT_DHCP_TYPE = 53;
const OPT_SERVER_ID = 54;
const OPT_PARAM_REQ_LIST = 55;
const OPT_CLIENT_ID = 61;
const OPT_END = 255;

function ipToInt(ip) {
  const parts = ip.split('.').map(Number);
  // eslint-disable-next-line no-bitwise
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}
function intToIp(n) {
  // eslint-disable-next-line no-bitwise
  return [ (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff ].join('.');
}

class DhcpServer {
  constructor() {
    this.socket = null;
    this.running = false;
    this.config = null;
    this.registry = null;
    this.onEvent = null;
    this.getGlobalConfig = null; // 用于读取全局 dnsConfig
  }

  /**
   * @param cfg {object} 来自 config.routerSystem
   *   { enabled, interface, subnetCidr, dhcp: { rangeStart, rangeEnd, leaseTimeHours, gateway }, serverIpOverride }
   * @param getConfig 可选，返回全局 config 的函数（用于读取 dnsConfig）
   */
  async start(cfg, registry, onEvent, getConfig) {
    this.getGlobalConfig = getConfig || null;
    if (this.running) await this.stop();
    this.config = cfg;
    this.registry = registry;
    this.onEvent = onEvent || (() => {});

    const dhcp = cfg.dhcp || {};
    if (!dhcp.rangeStart || !dhcp.rangeEnd) {
      throw new Error('DHCP 范围未配置');
    }
    if (!dhcp.gateway) {
      throw new Error('DHCP 网关未配置');
    }

    // 服务器 IP = 路由器在该网段的 IP（取自 subnetCidr 的 IP 部分）
    this.serverIp = cfg.serverIpOverride || (cfg.subnetCidr || '').split('/')[0];
    if (!this.serverIp) throw new Error('路由器 IP 未配置（subnetCidr）');

    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('error', (err) => {
        getLogger().error(`[DHCP] socket error: ${err.message}`);
        if (!this.running) {
          reject(err);
        }
      });
      sock.on('message', (msg, rinfo) => {
        try { this._handle(msg, rinfo); } catch (e) {
          getLogger().warn(`[DHCP] handle error: ${e.message}`);
        }
      });
      sock.bind(67, '0.0.0.0', () => {
        sock.setBroadcast(true);
        this.socket = sock;
        this.running = true;
        getLogger().info(`[DHCP] server listening on 0.0.0.0:67 (gateway=${dhcp.gateway}, range=${dhcp.rangeStart}-${dhcp.rangeEnd})`);
        resolve();
      });
    });
  }

  async stop() {
    if (this.socket) {
      try { this.socket.close(); } catch (e) {}
      this.socket = null;
    }
    this.running = false;
    getLogger().info('[DHCP] server stopped');
  }

  isRunning() { return this.running; }

  _handle(msg, rinfo) {
    if (msg.length < 240) return;
    // BOOTP header
    const op = msg.readUInt8(0);
    const htype = msg.readUInt8(1);
    const hlen = msg.readUInt8(2);
    const xid = msg.readUInt32BE(4);
    const flags = msg.readUInt16BE(10);
    const ciaddr = msg.slice(12, 16).join('.');          // client IP
    const yiaddr_buf = msg.slice(16, 20);
    const siaddr = msg.slice(20, 24).join('.');           // server IP (next)
    const chaddr = msg.slice(28, 28 + hlen);             // client hardware addr
    const mac = chaddr.toString('hex').match(/.{2}/g).join(':').toUpperCase();

    // magic cookie 0x63825363 at offset 236
    if (msg.readUInt32BE(236) !== 0x63825363) return;

    // 解析 options
    const opts = this._parseOptions(msg.slice(240));
    const msgType = opts[OPT_DHCP_TYPE];
    if (!msgType) return;

    if (msgType === MSG_DISCOVER) {
      this._onDiscover(xid, mac, opts, yiaddr_buf);
    } else if (msgType === MSG_REQUEST) {
      this._onRequest(xid, mac, opts, ciaddr, yiaddr_buf, flags);
    } else if (msgType === MSG_RELEASE) {
      this.registry.releaseLease(mac);
      this.onEvent('release', { mac });
    } else if (msgType === MSG_DECLINE) {
      const reqIp = opts[50] ? this._bufToIp(opts[50]) : null;
      this.registry.markConflict(reqIp);
      getLogger().warn(`[DHCP] DECLINE from ${mac} for ${reqIp}`);
    }
  }

  _onDiscover(xid, mac, opts, yiaddr_buf) {
    const hostnameOpt = opts[12];
    const hostname = hostnameOpt ? hostnameOpt.toString('utf8') : '';
    const reqIp = opts[50] ? this._bufToIp(opts[50]) : null;

    // 检查 MAC 过滤
    if (!this.registry.isMacAllowed(mac)) {
      getLogger().info(`[DHCP] DISCOVER from ${mac} blocked by MAC filter`);
      return; // 静默丢弃，不发 OFFER
    }

    // 检查设备是否被禁用
    const existing = this.registry.getLease(mac);
    if (existing && existing.enabled === false) {
      getLogger().info(`[DHCP] DISCOVER from ${mac} device disabled, ignoring`);
      return;
    }

    const lease = this.registry.allocateLease(mac, hostname, reqIp);
    if (!lease) {
      getLogger().warn(`[DHCP] DISCOVER from ${mac} no IP available`);
      return;
    }

    const offer = this._buildReply(2, xid, lease.ip, mac);
    this._send(offer, '255.255.255.255', 68);
    getLogger().info(`[DHCP] OFFER ${lease.ip} to ${mac} (${hostname})`);
    this.onEvent('offer', { mac, ip: lease.ip, hostname });
  }

  _onRequest(xid, mac, opts, ciaddr, yiaddr_buf, flags) {
    const hostnameOpt = opts[12];
    const hostname = hostnameOpt ? hostnameOpt.toString('utf8') : '';
    // 客户端请求的 IP 在 option 50 (Requested IP)，或 ciaddr
    const requestedIp = opts[50] ? this._bufToIp(opts[50]) : (ciaddr && ciaddr !== '0.0.0.0' ? ciaddr : null);
    // Server identifier 校验：如果带了 option 54 且不是本机 IP，忽略
    const serverIdOpt = opts[54];
    if (serverIdOpt) {
      const sid = this._bufToIp(serverIdOpt);
      if (sid !== this.serverIp) {
        getLogger().info(`[DHCP] REQUEST from ${mac} for other server ${sid}, ignore`);
        return;
      }
    }

    if (!this.registry.isMacAllowed(mac)) {
      // 发 NAK
      const nak = this._buildReply(6, xid, '0.0.0.0', mac);
      this._send(nak, '255.255.255.255', 68);
      getLogger().info(`[DHCP] NAK to ${mac} (MAC filter)`);
      return;
    }

    const lease = this.registry.confirmLease(mac, hostname, requestedIp);
    if (!lease) {
      // 分配失败：发 NAK
      const nak = this._buildReply(6, xid, '0.0.0.0', mac);
      this._send(nak, '255.255.255.255', 68);
      getLogger().info(`[DHCP] NAK to ${mac} (no lease)`);
      return;
    }

    if (lease.enabled === false) {
      const nak = this._buildReply(6, xid, '0.0.0.0', mac);
      this._send(nak, '255.255.255.255', 68);
      getLogger().info(`[DHCP] NAK to ${mac} (device disabled)`);
      return;
    }

    const ack = this._buildReply(5, xid, lease.ip, mac);
    this._send(ack, '255.255.255.255', 68);
    getLogger().info(`[DHCP] ACK ${lease.ip} to ${mac} (${hostname})`);
    this.onEvent('ack', { mac, ip: lease.ip, hostname });
  }

  _buildReply(msgType, xid, yiaddr, mac) {
    // 300 字节基础 BOOTP + options
    const buf = Buffer.alloc(576, 0);
    buf.writeUInt8(2, 0);           // op = BOOTREPLY
    buf.writeUInt8(1, 1);           // htype = Ethernet
    buf.writeUInt8(6, 2);           // hlen
    buf.writeUInt32BE(xid, 4);      // xid
    buf.writeUInt16BE(0, 10);       // flags = unicast
    // ciaddr = 0.0.0.0
    yiaddr.split('.').forEach((o, i) => buf.writeUInt8(parseInt(o), 16 + i));
    // siaddr = serverIp
    this.serverIp.split('.').forEach((o, i) => buf.writeUInt8(parseInt(o), 20 + i));
    // giaddr = 0.0.0.0 (skip)
    // chaddr
    const macBytes = mac.split(':').map(h => parseInt(h, 16));
    macBytes.forEach((b, i) => buf.writeUInt8(b, 28 + i));
    // magic cookie
    buf.writeUInt32BE(0x63825363, 236);

    // ---- options ----
    let off = 240;
    const dhcp = this.config.dhcp || {};
    const leaseMs = (dhcp.leaseTimeHours || 24) * 3600 * 1000;

    // 53: DHCP Message Type
    off = this._writeOpt(buf, off, OPT_DHCP_TYPE, Buffer.from([msgType]));
    // 54: Server Identifier
    off = this._writeOpt(buf, off, OPT_SERVER_ID, Buffer.from(this.serverIp.split('.').map(Number)));
    // 51: Lease Time (seconds)
    const leaseSec = Buffer.alloc(4);
    leaseSec.writeUInt32BE(Math.floor(leaseMs / 1000), 0);
    off = this._writeOpt(buf, off, OPT_LEASE_TIME, leaseSec);
    // 1: Subnet Mask
    const mask = this._cidrMask(this.config.subnetCidr);
    off = this._writeOpt(buf, off, OPT_SUBNET_MASK, Buffer.from(mask.split('.').map(Number)));
    // 3: Router (Gateway)
    off = this._writeOpt(buf, off, OPT_ROUTER, Buffer.from((dhcp.gateway || this.serverIp).split('.').map(Number)));
    // 6: DNS - 从全局 dnsConfig 读取，仅取纯 IPv4 格式（DHCP option 6 只支持 IPv4）
    const dnsArr = this._resolveDnsList(dhcp);
    const dnsBuf = Buffer.alloc(dnsArr.length * 4);
    dnsArr.forEach((d, i) => d.split('.').forEach((o, j) => dnsBuf.writeUInt8(parseInt(o), i * 4 + j)));
    off = this._writeOpt(buf, off, OPT_DNS, dnsBuf);
    // END
    buf.writeUInt8(OPT_END, off);
    off++;

    return buf.slice(0, off);
  }

  _writeOpt(buf, off, code, value) {
    buf.writeUInt8(code, off); off++;
    buf.writeUInt8(value.length, off); off++;
    value.copy(buf, off);
    off += value.length;
    return off;
  }

  _parseOptions(buf) {
    const opts = {};
    let i = 0;
    while (i < buf.length) {
      const code = buf.readUInt8(i);
      if (code === OPT_END) break;
      if (code === 0) { i++; continue; }   // PAD
      const len = buf.readUInt8(i + 1);
      const val = buf.slice(i + 2, i + 2 + len);
      opts[code] = val;
      i += 2 + len;
    }
    return opts;
  }

  _bufToIp(buf) {
    if (!buf || buf.length < 4) return null;
    return [buf[0], buf[1], buf[2], buf[3]].join('.');
  }

  _cidrMask(cidr) {
    const m = (cidr || '').match(/\/(\d+)$/);
    const prefix = m ? parseInt(m[1]) : 24;
    const maskInt = (0xFFFFFFFF << (32 - prefix)) >>> 0;
    return intToIp(maskInt);
  }

  /**
   * 从全局 dnsConfig.servers 读取 DNS，仅返回纯 IPv4 格式（DHCP option 6 只支持 IPv4）。
   * 跳过 tcp://、https:// 等带 scheme 的格式。
   * 如果全局没有配置或全是不支持的格式，回退到默认。
   */
  _resolveDnsList(localDhcp) {
    // 兼容老的 dhcp.dns 字段（如有则优先）
    if (Array.isArray(localDhcp.dns) && localDhcp.dns.length > 0) {
      return localDhcp.dns.filter(d => /^\d+\.\d+\.\d+\.\d+$/.test(d));
    }
    const defaults = ['223.5.5.5', '1.1.1.1'];
    if (!this.getGlobalConfig) return defaults;
    try {
      const cfg = this.getGlobalConfig();
      const servers = (cfg.dnsConfig && Array.isArray(cfg.dnsConfig.servers)) ? cfg.dnsConfig.servers : [];
      const ips = servers
        .map(s => (s && s.address) ? s.address : '')
        .filter(addr => /^\d+\.\d+\.\d+\.\d+$/.test(addr)); // 仅纯 IPv4
      if (ips.length === 0) return defaults;
      return ips.slice(0, 4); // DHCP 最多下发 4 个
    } catch (e) {
      return defaults;
    }
  }

  _send(buf, host, port) {
    if (!this.socket) return;
    this.socket.send(buf, 0, buf.length, port, host, (err) => {
      if (err) getLogger().warn(`[DHCP] send to ${host}:${port} failed: ${err.message}`);
    });
  }
}

module.exports = new DhcpServer();
