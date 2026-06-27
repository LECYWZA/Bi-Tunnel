const os = require('os');
const { exec } = require('child_process');
const { getLogger } = require('../utils/logger');
const dhcpServer = require('./dhcpServer');
const DeviceRegistry = require('./deviceRegistry');
const macFilter = require('../utils/macFilter');
const transparentProxy = require('../utils/transparentProxy');

const isLinux = os.platform() === 'linux';
const isWindows = os.platform() === 'win32';

function execPromise(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}

let deviceRegistry = null;
let arpTimer = null;
let running = false;
// 记录 start() 时应用的副作用，用于 stop() 时回滚
let lastAppliedIface = null;
let lastAppliedIp = null;
let lastAppliedPrefix = null;
let lastWildcard = false;

/**
 * 启动路由器
 *
 * @param cfg routerSystem 配置对象（已 read-only 视图，写入通过 saveConfig）
 * @param getConfig 返回当前 config 的函数
 * @param saveConfig 保存 config 的函数
 * @param onEvent 事件回调 (type, payload) -> 用于广播 WS
 */
async function start(cfg, getConfig, saveConfig, onEvent) {
  if (running) {
    getLogger().warn('[Router] already running');
    return;
  }

  if (!deviceRegistry) {
    deviceRegistry = new DeviceRegistry(getConfig, saveConfig);
  }

  const iface = cfg.interface;
  const cidr = cfg.subnetCidr || '';
  if (!iface) throw new Error('未选择网卡');
  if (!cidr) throw new Error('未配置网段');

  // 0.0.0.0 表示不绑定具体网卡，仅启动 DHCP（用于已有路由环境）
  const isWildcard = iface === '0.0.0.0';

  // 校验网卡存在
  if (!isWildcard) {
    const ifaces = os.networkInterfaces();
    if (!ifaces[iface]) {
      throw new Error(`网卡 ${iface} 不存在`);
    }
  }

  // 解析网段
  const m = cidr.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
  if (!m) throw new Error(`网段格式错误：${cidr}`);
  const routerIp = m[1];
  const prefix = parseInt(m[2]);
  if (prefix < 8 || prefix > 30) throw new Error(`网段前缀不合理：${prefix}`);

  // 1. 配置网卡 IP（若不存在则添加）
  if (!isWildcard) {
    await _ensureInterfaceIp(iface, routerIp, prefix);
  }

  // 2. 开启 IP 转发（仅绑定具体网卡时需要；wildcard 模式下不修改系统网络栈）
  if (!isWildcard) {
    await _enableForwarding();
  } else {
    getLogger().info('[Router] wildcard interface 0.0.0.0，跳过 IP 转发开启');
  }

  // 记录已应用的副作用，stop() 时用于回滚
  lastAppliedIface = iface;
  lastAppliedIp = routerIp;
  lastAppliedPrefix = prefix;
  lastWildcard = isWildcard;

  // 3. NAT 出网（MASQUERADE）
  if (!isWildcard) {
    await _enableNat(iface);
  } else {
    getLogger().info('[Router] wildcard interface 0.0.0.0，跳过 NAT 与网卡 IP 配置');
  }

  // 4. MAC 过滤
  if (!isWildcard) {
    const macFilterCfg = cfg.macFilter || { mode: 'disabled', addresses: [] };
    await macFilter.applyFilter(macFilterCfg.mode || 'disabled', macFilterCfg.addresses || [], iface);
  }

  // 5. 出口代理
  const upstreamMode = cfg.upstreamMode || 'direct';
  if (upstreamMode === 'proxy' && cfg.upstreamProxyId && !isWildcard) {
    // 查找该代理对应的端口
    const proxyPort = _findProxyPort(getConfig(), cfg.upstreamProxyId);
    if (proxyPort) {
      const ok = await transparentProxy.enable(iface, proxyPort);
      if (!ok) {
        // Windows 降级：建议自动切换到 TUN 模式（如果已开启）
        getLogger().warn('[Router] 透明代理不可用，请改用 TUN 模式或系统代理模式');
      }
    } else {
      getLogger().warn(`[Router] 代理 ${cfg.upstreamProxyId} 未找到，跳过透明代理`);
    }
  }

  // 6. DHCP 服务器（覆盖 cfg.serverIpOverride 给 DHCP 用）
  if (cfg.dhcp && cfg.dhcp.enabled) {
    const dhcpCfg = { ...cfg, serverIpOverride: routerIp };
    await dhcpServer.start(dhcpCfg, deviceRegistry, (type, payload) => {
      if (onEvent) onEvent('dhcp_' + type, payload);
    }, getConfig);
  }

  // 7. 启动 ARP 周期同步
  arpTimer = setInterval(() => {
    _readArp(iface).then(entries => {
      deviceRegistry.syncFromArp(entries);
      if (onEvent) onEvent('devices_update', deviceRegistry.listDevices());
    }).catch(() => {});
  }, 30000);

  // 首次同步一次
  try {
    const entries = await _readArp(iface);
    deviceRegistry.syncFromArp(entries);
  } catch (e) {}

  running = true;
  getLogger().info(`[Router] started on ${iface} (${cidr})`);
}

async function stop() {
  if (!running) return;

  if (arpTimer) {
    clearInterval(arpTimer);
    arpTimer = null;
  }

  try { await dhcpServer.stop(); } catch (e) {}

  try { await transparentProxy.disable(); } catch (e) {}
  try { await macFilter.clearFilter(); } catch (e) {}

  // 反向 NAT
  try { await _disableNat(); } catch (e) {}

  // 清理网卡 IP（移除路由器添加的 secondary IP）
  if (lastAppliedIface && lastAppliedIp && !lastWildcard) {
    try { await _removeInterfaceIp(lastAppliedIface, lastAppliedIp, lastAppliedPrefix); } catch (e) {}
  }

  // 关闭 IP 转发（恢复注册表）
  try { await _disableForwarding(); } catch (e) {}

  running = false;
  lastAppliedIface = null;
  lastAppliedIp = null;
  lastAppliedPrefix = null;
  lastWildcard = false;
  getLogger().info('[Router] stopped');
}

function isRunning() { return running; }

function getDeviceRegistry() { return deviceRegistry; }

// -------- 内部工具 --------

async function _ensureInterfaceIp(iface, ip, prefix) {
  const mask = _prefixToMask(prefix);
  if (isLinux) {
    // 检查是否已配置
    try {
      const out = await execPromise(`ip addr show dev ${iface}`);
      if (out.includes(`${ip}/${prefix}`)) return;
    } catch (e) {}
    // 添加 secondary IP（不覆盖现有）
    try {
      await execPromise(`ip addr add ${ip}/${prefix} dev ${iface}`);
      getLogger().info(`[Router] added ${ip}/${prefix} to ${iface}`);
    } catch (e) {
      if (!String(e.message).includes('File exists')) {
        getLogger().warn(`[Router] add IP failed: ${e.message}`);
      }
    }
  } else if (isWindows) {
    // 检查现有 IP
    try {
      const out = await execPromise(`netsh interface ip show ipaddress ${iface}`);
      if (out.includes(ip)) return;
    } catch (e) {}
    try {
      await execPromise(`netsh interface ip add address "${iface}" ${ip} ${mask}`);
      getLogger().info(`[Router] added ${ip} ${mask} to ${iface}`);
    } catch (e) {
      getLogger().warn(`[Router] add IP failed: ${e.message}`);
    }
  }
}

async function _enableForwarding() {
  if (isLinux) {
    try {
      await execPromise('sysctl -w net.ipv4.ip_forward=1');
      getLogger().info('[Router] enabled IPv4 forwarding');
    } catch (e) {
      getLogger().warn(`[Router] enable forwarding failed: ${e.message}`);
    }
  } else if (isWindows) {
    // 设置注册表 IPEnableRouter=1，需要 RoutingAndRemoteAccess 服务
    try {
      await execPromise(`powershell -Command "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters' -Name 'IPEnableRouter' -Value 1 -Type DWord"`);
      getLogger().info('[Router] set IPEnableRouter=1 (需要重启路由服务才生效)');
    } catch (e) {
      getLogger().warn(`[Router] set IPEnableRouter failed: ${e.message}`);
    }
  }
}

async function _disableForwarding() {
  if (isLinux) {
    try {
      await execPromise('sysctl -w net.ipv4.ip_forward=0');
      getLogger().info('[Router] disabled IPv4 forwarding');
    } catch (e) {
      getLogger().warn(`[Router] disable forwarding failed: ${e.message}`);
    }
  } else if (isWindows) {
    try {
      await execPromise(`powershell -Command "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters' -Name 'IPEnableRouter' -Value 0 -Type DWord"`);
      getLogger().info('[Router] restored IPEnableRouter=0');
    } catch (e) {
      getLogger().warn(`[Router] restore IPEnableRouter failed: ${e.message}`);
    }
  }
}

async function _removeInterfaceIp(iface, ip, prefix) {
  if (isLinux) {
    try {
      await execPromise(`ip addr del ${ip}/${prefix} dev ${iface} 2>/dev/null`);
      getLogger().info(`[Router] removed ${ip}/${prefix} from ${iface}`);
    } catch (e) {
      // 静默：IP 可能已被其他方式清除
    }
  } else if (isWindows) {
    try {
      await execPromise(`netsh interface ip delete address "${iface}" ${ip}`);
      getLogger().info(`[Router] removed ${ip} from ${iface}`);
    } catch (e) {
      // 静默
    }
  }
}

async function _enableNat(lanIface) {
  if (isLinux) {
    // 自动选择默认出口网卡
    const wanIface = await _detectDefaultInterface();
    try {
      await execPromise(`iptables -t nat -A POSTROUTING -o ${wanIface} -j MASQUERADE -m comment --comment "${CHAIN_TAG}"`);
      await execPromise(`iptables -A FORWARD -i ${lanIface} -o ${wanIface} -j ACCEPT -m comment --comment "${CHAIN_TAG}"`);
      await execPromise(`iptables -A FORWARD -i ${wanIface} -o ${lanIface} -m state --state RELATED,ESTABLISHED -j ACCEPT -m comment --comment "${CHAIN_TAG}"`);
      getLogger().info(`[Router] enabled NAT: ${lanIface} -> ${wanIface}`);
    } catch (e) {
      getLogger().warn(`[Router] enable NAT failed: ${e.message}`);
    }
  } else if (isWindows) {
    // Windows 共享访问 (ICS) 比较复杂，需启动服务并配置 Public/Private
    // 此处仅做日志提示，更详细的 ICS 配置可后续补充
    getLogger().info('[Router] Windows NAT 需要通过 netsh routing 或 ICS，已记录配置');
    // 尝试用 netsh routing（可能不支持家用版）
    try {
      await execPromise('netsh routing ip nat install');
      await execPromise(`netsh routing ip nat add interface ${lanIface}`);
      getLogger().info(`[Router] enabled Windows NAT on ${lanIface}`);
    } catch (e) {
      getLogger().warn(`[Router] Windows NAT via netsh routing failed (可能版本不支持): ${e.message}`);
    }
  }
}

async function _disableNat() {
  if (isLinux) {
    try {
      // 删除 FORWARD 链上带标记的规则
      await _clearChainByTag('filter', 'FORWARD', CHAIN_TAG);
      // 删除 nat POSTROUTING 链上带标记的规则
      await _clearChainByTag('nat', 'POSTROUTING', CHAIN_TAG);
      getLogger().info('[Router] NAT rules removed');
    } catch (e) {
      getLogger().warn(`[Router] disable NAT failed: ${e.message}`);
    }
  } else if (isWindows) {
    try {
      await execPromise(`netsh routing ip nat delete interface`);
    } catch (e) {}
  }
}

async function _clearChainByTag(table, chain, tag) {
  try {
    const out = await execPromise(`iptables -t ${table} -S ${chain} 2>/dev/null`);
    const lines = out.split('\n');
    const toDelete = [];
    lines.forEach((line, idx) => {
      if (line.includes(tag)) toDelete.push(idx + 1);
    });
    toDelete.reverse();
    for (const lineNum of toDelete) {
      try { await execPromise(`iptables -t ${table} -D ${chain} ${lineNum}`); } catch (e) {}
    }
  } catch (e) {}
}

async function _detectDefaultInterface() {
  if (isLinux) {
    try {
      const out = await execPromise('ip route show default');
      const m = out.match(/dev\s+(\S+)/);
      if (m) return m[1];
    } catch (e) {}
    return 'eth0';
  }
  if (isWindows) return null; // Windows 用 ICS 不需要指定 wan
  return null;
}

async function _readArp(iface) {
  const entries = [];
  // 0.0.0.0 / wildcard 模式下不传 iface 参数
  const isWildcard = !iface || iface === '0.0.0.0';
  if (isLinux) {
    try {
      const cmd = isWildcard
        ? `ip neigh show 2>/dev/null || arp -an`
        : `ip neigh show dev ${iface} 2>/dev/null || arp -an`;
      const out = await execPromise(cmd);
      for (const line of out.split('\n')) {
        // ip neigh 格式: 192.168.1.5 lladdr aa:bb:cc:dd:ee:ff REACHABLE
        const m = line.match(/(\d+\.\d+\.\d+\.\d+).*lladdr\s+([0-9a-fA-F:]+)/);
        if (m) entries.push({ ip: m[1], mac: m[2].toUpperCase() });
      }
    } catch (e) {}
  } else if (isWindows) {
    try {
      const out = await execPromise('arp -a');
      // 格式: 192.168.1.5         aa-bb-cc-dd-ee-ff     dynamic
      for (const line of out.split('\n')) {
        const m = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F-]+)\s+(\w+)/);
        if (m) {
          const mac = m[2].replace(/-/g, ':').toUpperCase();
          if (mac !== 'FF-FF-FF-FF-FF-FF'.replace(/-/g, ':')) {
            entries.push({ ip: m[1], mac, hostname: '' });
          }
        }
      }
    } catch (e) {}
  }
  return entries;
}

function _prefixToMask(prefix) {
  // eslint-disable-next-line no-bitwise
  const maskInt = (0xFFFFFFFF << (32 - prefix)) >>> 0;
  // eslint-disable-next-line no-bitwise
  return [ (maskInt >>> 24) & 0xff, (maskInt >>> 16) & 0xff, (maskInt >>> 8) & 0xff, maskInt & 0xff ].join('.');
}

function _findProxyPort(config, proxyId) {
  // 服务端代理 + 客户端代理
  const lists = [];
  if (config.server && Array.isArray(config.server.proxies)) lists.push(...config.server.proxies);
  if (config.client && Array.isArray(config.client.proxies)) lists.push(...config.client.proxies);
  const proxy = lists.find(p => p.id === proxyId);
  return proxy ? proxy.listenPort : null;
}

const CHAIN_TAG = 'bi-tunnel-router';

module.exports = { start, stop, isRunning, getDeviceRegistry };
