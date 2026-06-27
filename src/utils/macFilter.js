const os = require('os');
const { exec } = require('child_process');
const { getLogger } = require('../utils/logger');

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

/**
 * MAC 过滤工具
 *
 * 策略：
 *  - Linux: 用 iptables FORWARD 链按 mac-source DROP
 *  - Windows: 原生不支持 MAC 过滤，依赖 DHCP 层拒绝。
 *           本模块提供 noop 实现，调用方需配合 dhcpServer 的 isMacAllowed() 拒绝续约。
 *
 * 所有规则以 "bi-tunnel-router" 作为注释标记，便于清理。
 */

const CHAIN_TAG = 'bi-tunnel-router';

async function applyFilter(mode, addresses, iface) {
  // 先清理已有标记
  await clearFilter();

  if (!mode || mode === 'disabled') return true;
  if (!Array.isArray(addresses) || addresses.length === 0) return true;

  const list = addresses.map(m => (m || '').toUpperCase());

  if (isLinux) {
    try {
      for (const mac of list) {
        const action = mode === 'whitelist' ? 'ACCEPT' : 'DROP';
        // whitelist = 仅放行白名单：默认 DROP，对白名单 ACCEPT
        // blacklist = 仅阻断黑名单：默认 ACCEPT，对黑名单 DROP
        if (mode === 'whitelist') {
          await execPromise(`iptables -A FORWARD -i ${iface} -m mac --mac-source ${mac} -j ACCEPT -m comment --comment "${CHAIN_TAG}"`);
        } else {
          await execPromise(`iptables -A FORWARD -i ${iface} -m mac --mac-source ${mac} -j DROP -m comment --comment "${CHAIN_TAG}"`);
        }
      }
      if (mode === 'whitelist') {
        // 末尾追加 DROP 兜底
        await execPromise(`iptables -A FORWARD -i ${iface} -j DROP -m comment --comment "${CHAIN_TAG}"`);
      }
      getLogger().info(`[MACFilter] applied ${mode} (${list.length} entries) on ${iface}`);
      return true;
    } catch (err) {
      getLogger().error(`[MACFilter] applyFilter failed: ${err.message}`);
      return false;
    }
  }

  if (isWindows) {
    // Windows: 仅返回 true，过滤在 DHCP 层完成
    getLogger().info(`[MACFilter] Windows 平台 MAC 过滤依赖 DHCP 层拒绝 (${mode}, ${list.length})`);
    return true;
  }

  return false;
}

async function clearFilter() {
  if (isLinux) {
    // 反复删除带 CHAIN_TAG 注释的规则，直到没有匹配
    let removed = 0;
    for (let i = 0; i < 50; i++) {
      try {
        // -D 删除第一条匹配的规则
        await execPromise(`iptables -D FORWARD -m comment --comment "${CHAIN_TAG}" 2>/dev/null || true`);
        // 检查是否还有匹配
        const out = await execPromise(`iptables -S FORWARD 2>/dev/null | grep ${CHAIN_TAG} || true`);
        if (!out) break;
        removed++;
      } catch (e) {
        break;
      }
    }
    // 由于 -D 一次只删一条，且 -m comment --comment 单独无法定位具体行
    // 改为基于编号删除：先列出再倒序删除
    try {
      const out = await execPromise(`iptables -S FORWARD 2>/dev/null`);
      const lines = out.split('\n');
      const toDelete = [];
      lines.forEach((line, idx) => {
        if (line.includes(CHAIN_TAG)) toDelete.push(idx + 1);
      });
      // 倒序删除避免编号偏移
      toDelete.reverse();
      for (const lineNum of toDelete) {
        try { await execPromise(`iptables -D FORWARD ${lineNum}`); } catch (e) {}
      }
    } catch (e) {}
    getLogger().info(`[MACFilter] cleared ${removed} rule(s)`);
    return true;
  }
  if (isWindows) return true;
  return false;
}

module.exports = { applyFilter, clearFilter };
