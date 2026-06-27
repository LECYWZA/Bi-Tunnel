const net = require('net');
const { getLogger } = require('../utils/logger');

/**
 * 设备注册表 + DHCP 租约管理
 *
 * 数据存储在 config.routerSystem.devices[]，结构：
 *   { mac, ip, hostname, enabled, firstSeen, lastSeen, expiresAt, source }
 *     - source: 'dhcp' | 'static' | 'arp'
 *     - enabled: false 表示该设备被禁用，DHCP 会拒绝续约
 *
 * 静态绑定在 config.routerSystem.staticBindings[]：
 *   { mac, ip, name }
 *   静态绑定的设备始终优先于 DHCP 池
 *
 * MAC 过滤在 config.routerSystem.macFilter：
 *   { mode: 'disabled'|'whitelist'|'blacklist', addresses: [mac...] }
 */

function ipToInt(ip) {
  const p = ip.split('.').map(Number);
  // eslint-disable-next-line no-bitwise
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
function intToIp(n) {
  // eslint-disable-next-line no-bitwise
  return [ (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff ].join('.');
}

class DeviceRegistry {
  constructor(getConfig, saveConfig) {
    this.getConfig = getConfig;
    this.saveConfig = saveConfig;
  }

  _router() {
    const cfg = this.getConfig();
    if (!cfg.routerSystem) cfg.routerSystem = {};
    return cfg.routerSystem;
  }

  _devices() {
    const r = this._router();
    if (!Array.isArray(r.devices)) r.devices = [];
    return r.devices;
  }

  /**
   * MAC 是否允许注册（依据 macFilter 模式）
   */
  isMacAllowed(mac) {
    const r = this._router();
    const filter = r.macFilter || { mode: 'disabled', addresses: [] };
    const m = (mac || '').toUpperCase();
    if (filter.mode === 'disabled' || !filter.addresses) return true;
    const list = filter.addresses.map(x => (x || '').toUpperCase());
    if (filter.mode === 'whitelist') {
      return list.includes(m);
    }
    if (filter.mode === 'blacklist') {
      return !list.includes(m);
    }
    return true;
  }

  /**
   * 查找现有租约
   */
  getLease(mac) {
    const m = (mac || '').toUpperCase();
    return this._devices().find(d => d.mac === m) || null;
  }

  /**
   * 分配租约（DISCOVER 时调用）。
   * @param requestedIp 客户端请求的 IP（option 50），可空
   */
  allocateLease(mac, hostname, requestedIp) {
    mac = (mac || '').toUpperCase();
    const r = this._router();
    const dhcp = r.dhcp || {};
    const now = Date.now();
    const leaseMs = (dhcp.leaseTimeHours || 24) * 3600 * 1000;

    // 1. 静态绑定优先
    const staticBind = (r.staticBindings || []).find(b => (b.mac || '').toUpperCase() === mac);
    if (staticBind) {
      return this._upsertDevice({
        mac, ip: staticBind.ip, hostname: hostname || staticBind.name || '',
        enabled: true, source: 'static',
        firstSeen: now, lastSeen: now, expiresAt: now + leaseMs
      });
    }

    // 2. 已有租约：续约
    const exist = this._devices().find(d => d.mac === mac);
    if (exist) {
      exist.lastSeen = now;
      exist.expiresAt = now + leaseMs;
      if (hostname) exist.hostname = hostname;
      this._persist();
      return exist;
    }

    // 3. 客户端请求的 IP 可用
    if (requestedIp && net.isIP(requestedIp)) {
      const used = this._devices().find(d => d.ip === requestedIp);
      if (!used && this._inRange(requestedIp, dhcp)) {
        return this._upsertDevice({
          mac, ip: requestedIp, hostname: hostname || '',
          enabled: true, source: 'dhcp',
          firstSeen: now, lastSeen: now, expiresAt: now + leaseMs
        });
      }
    }

    // 4. 在范围内顺序分配
    const start = dhcp.rangeStart;
    const end = dhcp.rangeEnd;
    if (!start || !end) return null;
    const startInt = ipToInt(start);
    const endInt = ipToInt(end);
    const usedIps = new Set(this._devices().map(d => d.ip));
    // 跳过 .0 .255 之类的网络/广播地址
    for (let i = startInt; i <= endInt; i++) {
      const candidate = intToIp(i);
      if (usedIps.has(candidate)) continue;
      const last = i & 0xff;
      if (last === 0 || last === 255) continue;
      return this._upsertDevice({
        mac, ip: candidate, hostname: hostname || '',
        enabled: true, source: 'dhcp',
        firstSeen: now, lastSeen: now, expiresAt: now + leaseMs
      });
    }
    return null;
  }

  /**
   * 确认租约（REQUEST 时调用）。
   * 返回 lease 对象或 null（冲突时）。
   */
  confirmLease(mac, hostname, requestedIp) {
    mac = (mac || '').toUpperCase();
    const r = this._router();
    const dhcp = r.dhcp || {};
    const now = Date.now();
    const leaseMs = (dhcp.leaseTimeHours || 24) * 3600 * 1000;

    // 静态绑定
    const staticBind = (r.staticBindings || []).find(b => (b.mac || '').toUpperCase() === mac);
    if (staticBind) {
      if (requestedIp && requestedIp !== staticBind.ip) return null;
      return this._upsertDevice({
        mac, ip: staticBind.ip, hostname: hostname || staticBind.name || '',
        enabled: true, source: 'static',
        firstSeen: now, lastSeen: now, expiresAt: now + leaseMs
      });
    }

    const exist = this._devices().find(d => d.mac === mac);
    if (exist) {
      if (requestedIp && requestedIp !== exist.ip) {
        // 客户端请求的 IP 与已有租约不一致，确认是否被别人占用
        const occupier = this._devices().find(d => d.ip === requestedIp && d.mac !== mac);
        if (occupier) return null;
        // 切换 IP
        exist.ip = requestedIp;
      }
      exist.lastSeen = now;
      exist.expiresAt = now + leaseMs;
      if (hostname) exist.hostname = hostname;
      this._persist();
      return exist;
    }

    // 没有现成租约：尝试按请求 IP 分配
    if (requestedIp && net.isIP(requestedIp)) {
      const occupier = this._devices().find(d => d.ip === requestedIp);
      if (occupier && occupier.mac !== mac) return null;
      if (!this._inRange(requestedIp, dhcp)) return null;
      return this._upsertDevice({
        mac, ip: requestedIp, hostname: hostname || '',
        enabled: true, source: 'dhcp',
        firstSeen: now, lastSeen: now, expiresAt: now + leaseMs
      });
    }

    // 兜底重新分配
    return this.allocateLease(mac, hostname, null);
  }

  releaseLease(mac) {
    mac = (mac || '').toUpperCase();
    const devs = this._devices();
    const idx = devs.findIndex(d => d.mac === mac);
    if (idx >= 0 && devs[idx].source !== 'static') {
      devs.splice(idx, 1);
      this._persist();
      getLogger().info(`[Registry] lease released for ${mac}`);
    }
  }

  markConflict(ip) {
    if (!ip) return;
    const devs = this._devices();
    const d = devs.find(x => x.ip === ip);
    if (d && d.source !== 'static') {
      getLogger().warn(`[Registry] conflict on ${ip} from ${d.mac}, releasing`);
      // 标记过期，下次续约会被替换
      d.expiresAt = 0;
      this._persist();
    }
  }

  /**
   * 通过 ARP 表补充未在 DHCP 上线但已接入的设备。
   * @param arpEntries [{mac, ip}]
   */
  syncFromArp(arpEntries) {
    if (!Array.isArray(arpEntries)) return;
    const now = Date.now();
    const r = this._router();
    const dhcp = r.dhcp || {};
    const leaseMs = (dhcp.leaseTimeHours || 24) * 3600 * 1000;
    let changed = false;
    for (const e of arpEntries) {
      if (!e.mac || !e.ip) continue;
      const mac = e.mac.toUpperCase();
      // 静态绑定也加上 ARP 来源记录（如果尚无记录）
      const exist = this._devices().find(d => d.mac === mac);
      if (exist) {
        if (exist.ip !== e.ip) exist.ip = e.ip;
        exist.lastSeen = now;
        changed = true;
        continue;
      }
      // 跳过 MAC 过滤不允许的设备
      if (!this.isMacAllowed(mac)) continue;
      this._devices().push({
        mac, ip: e.ip, hostname: e.hostname || '',
        enabled: true, source: 'arp',
        firstSeen: now, lastSeen: now, expiresAt: now + leaseMs
      });
      changed = true;
    }
    if (changed) this._persist();
  }

  listDevices() {
    const now = Date.now();
    return this._devices().map(d => ({
      ...d,
      online: d.expiresAt > now || (now - d.lastSeen) < 120000
    }));
  }

  setDeviceEnabled(mac, enabled) {
    mac = (mac || '').toUpperCase();
    const d = this._devices().find(x => x.mac === mac);
    if (!d) return false;
    d.enabled = !!enabled;
    this._persist();
    getLogger().info(`[Registry] device ${mac} ${enabled ? 'enabled' : 'disabled'}`);
    return true;
  }

  deleteDevice(mac) {
    mac = (mac || '').toUpperCase();
    const devs = this._devices();
    const idx = devs.findIndex(d => d.mac === mac);
    if (idx >= 0) {
      devs.splice(idx, 1);
      this._persist();
      return true;
    }
    return false;
  }

  kickDevice(mac) {
    // 释放租约并临时禁用，让设备立即下线
    mac = (mac || '').toUpperCase();
    const d = this._devices().find(x => x.mac === mac);
    if (!d) return false;
    if (d.source !== 'static') {
      this.deleteDevice(mac);
    } else {
      d.enabled = false;
      d.expiresAt = 0;
      this._persist();
    }
    return true;
  }

  _inRange(ip, dhcp) {
    if (!dhcp || !dhcp.rangeStart || !dhcp.rangeEnd) return false;
    const i = ipToInt(ip);
    return i >= ipToInt(dhcp.rangeStart) && i <= ipToInt(dhcp.rangeEnd);
  }

  _upsertDevice(dev) {
    const devs = this._devices();
    const idx = devs.findIndex(d => d.mac === dev.mac);
    if (idx >= 0) {
      // 保留 firstSeen/enabled
      const old = devs[idx];
      dev.firstSeen = old.firstSeen || dev.firstSeen;
      dev.enabled = old.enabled !== undefined ? old.enabled : true;
      devs[idx] = dev;
    } else {
      devs.push(dev);
    }
    this._persist();
    return dev;
  }

  _persist() {
    try { this.saveConfig(this.getConfig()); } catch (e) {
      getLogger().warn(`[Registry] persist failed: ${e.message}`);
    }
  }
}

module.exports = DeviceRegistry;
