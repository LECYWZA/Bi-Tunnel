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

const CHAIN_TAG = 'bi-tunnel-router';

/**
 * 透明代理工具：把路由器网段的流量重定向到指定的混合代理端口（Xray 透明代理入站口）。
 *
 * Linux 实现（iptables REDIRECT）：
 *   iptables -t nat -A PREROUTING -i <iface> -p tcp
 *            -m tcp --dport 80 -j REDIRECT --to-ports <proxyPort>
 *   iptables -t nat -A PREROUTING -i <iface> -p tcp
 *            -m tcp --dport 443 -j REDIRECT --to-ports <proxyPort>
 *   仅在 upstreamMode='proxy' 时启用
 *
 * Windows 实现：
 *   原生不支持 iptables REDIRECT，需要 WinDivert 等驱动层方案。
 *   本模块在 Windows 下直接返回 false，上层应降级为 tun 模式。
 *
 * 调用方需保证指定的混合代理已开启 Xray 的 dokodemo-door 透明代理入站。
 *   为简化实现：此处只做 REDIRECT，透明代理入站由现有 Xray 实例通过 SOCKS5 端口 + TUN 复用承担。
 *   即：调用者建议在 Linux 上直接 redirect 到代理的 SOCKS5 端口不行（SOCKS5 不是透明代理），
 *   因此本模块在 Linux 上把 80/443 流量 redirect 到代理的 listenPort，
 *   但 Xray 端需配置 dokodemo-door inbound 才能处理。
 *
 * 综合考虑：实际可用方案是让调用方在 enableTransparent 时确保 Xray 配置已包含
 *   dokodemo-door inbound（监听端口 = proxyPort），或在路由器网段上启用 TUN 模式。
 *
 * 此模块仅做 iptables 规则的添加/清除，不负责 Xray 配置生成。
 */

async function enable(lanIface, proxyPort) {
  if (!lanIface || !proxyPort) {
    throw new Error('enable 需提供 iface 和 proxyPort');
  }

  if (isLinux) {
    // 先清除
    await disable(lanIface);

    // 重定向常用端口到代理端口
    // Xray 的 SOCKS5/HTTP 入站端口在透明代理场景下并不直接可用，
    // 这里仅用于配合已配置 dokodemo-door 的 Xray 实例。
    const ports = [80, 443];
    for (const p of ports) {
      try {
        await execPromise(`iptables -t nat -A PREROUTING -i ${lanIface} -p tcp --dport ${p} -j REDIRECT --to-ports ${proxyPort} -m comment --comment "${CHAIN_TAG}"`);
      } catch (e) {
        getLogger().warn(`[TransparentProxy] redirect port ${p} failed: ${e.message}`);
      }
    }
    getLogger().info(`[TransparentProxy] enabled on ${lanIface} -> port ${proxyPort}`);
    return true;
  }

  if (isWindows) {
    getLogger().warn('[TransparentProxy] Windows 不支持 iptables REDIRECT，请使用 TUN 模式降级');
    return false;
  }

  return false;
}

async function disable(lanIface) {
  if (isLinux) {
    // 列出所有 PREROUTING 链中带 CHAIN_TAG 的规则并按行号删除
    try {
      const out = await execPromise(`iptables -t nat -S PREROUTING 2>/dev/null`);
      const lines = out.split('\n');
      const toDelete = [];
      lines.forEach((line, idx) => {
        if (line.includes(CHAIN_TAG)) toDelete.push(idx + 1);
      });
      toDelete.reverse();
      for (const lineNum of toDelete) {
        try { await execPromise(`iptables -t nat -D PREROUTING ${lineNum}`); } catch (e) {}
      }
      getLogger().info(`[TransparentProxy] disabled on ${lanIface || 'any'}, removed ${toDelete.length} rule(s)`);
      return true;
    } catch (err) {
      getLogger().warn(`[TransparentProxy] disable error: ${err.message}`);
      return false;
    }
  }
  if (isWindows) return true;
  return false;
}

module.exports = { enable, disable, supportsTransparent: () => isLinux };
