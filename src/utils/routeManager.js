const { exec } = require('child_process');
const os = require('os');
const net = require('net');
const { getLogger } = require('./logger');

const isLinux = os.platform() === 'linux';
const isWindows = os.platform() === 'win32';

let activeBypassIps = [];

function execPromise(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

/**
 * Detects the active default gateway and interface.
 */
async function getDefaultGateway() {
  try {
    if (isWindows) {
      const stdout = await execPromise('route print 0.0.0.0');
      const lines = stdout.split('\n');
      const gateways = [];
      for (let line of lines) {
        line = line.trim();
        const parts = line.split(/\s+/);
        if (parts.length >= 5 && parts[0] === '0.0.0.0' && parts[1] === '0.0.0.0') {
          const gw = parts[2];
          const iface = parts[3];
          const metric = parseInt(parts[4], 10);
          if (!isNaN(metric)) {
            gateways.push({ gateway: gw, interface: iface, metric });
          }
        }
      }
      gateways.sort((a, b) => a.metric - b.metric);
      if (gateways.length > 0) {
        return gateways[0];
      }
    } else if (isLinux) {
      const stdout = await execPromise('ip route show');
      const lines = stdout.split('\n');
      const gateways = [];
      for (let line of lines) {
        line = line.trim();
        if (!line.startsWith('default')) continue;
        const parts = line.split(/\s+/);
        const viaIdx = parts.indexOf('via');
        const devIdx = parts.indexOf('dev');
        const metricIdx = parts.indexOf('metric');
        if (viaIdx !== -1 && devIdx !== -1) {
          const gw = parts[viaIdx + 1];
          const iface = parts[devIdx + 1];
          let metric = 0;
          if (metricIdx !== -1 && metricIdx + 1 < parts.length) {
            metric = parseInt(parts[metricIdx + 1], 10) || 0;
          }
          gateways.push({ gateway: gw, interface: iface, metric });
        }
      }
      gateways.sort((a, b) => a.metric - b.metric);
      if (gateways.length > 0) {
        return gateways[0];
      }
    }
  } catch (err) {
    getLogger().error(`[RouteManager] Failed to detect default gateway: ${err.message}`);
  }
  return null;
}

/**
 * Adds a host route (/32) direct bypass for the physical gateway.
 */
async function addBypassRoute(ip, gatewayInfo) {
  if (!ip || !net.isIP(ip)) return false;
  if (!gatewayInfo || !gatewayInfo.gateway) return false;

  try {
    let success = false;
    if (isWindows) {
      await execPromise(`route add ${ip} mask 255.255.255.255 ${gatewayInfo.gateway}`);
      getLogger().info(`[RouteManager] Added Windows bypass route for ${ip} via ${gatewayInfo.gateway}`);
      success = true;
    } else if (isLinux) {
      const devCmd = gatewayInfo.interface ? `dev ${gatewayInfo.interface}` : '';
      await execPromise(`ip route add ${ip} via ${gatewayInfo.gateway} ${devCmd}`);
      getLogger().info(`[RouteManager] Added Linux bypass route for ${ip} via ${gatewayInfo.gateway}`);
      success = true;
    }
    if (success) {
      if (!activeBypassIps.includes(ip)) {
        activeBypassIps.push(ip);
      }
    }
    return success;
  } catch (err) {
    getLogger().error(`[RouteManager] Failed to add bypass route for ${ip}: ${err.message}`);
  }
  return false;
}

/**
 * Removes a host route direct bypass.
 */
async function removeBypassRoute(ip) {
  if (!ip || !net.isIP(ip)) return false;

  try {
    let success = false;
    if (isWindows) {
      await execPromise(`route delete ${ip}`);
      getLogger().info(`[RouteManager] Removed Windows bypass route for ${ip}`);
      success = true;
    } else if (isLinux) {
      await execPromise(`ip route del ${ip}`);
      getLogger().info(`[RouteManager] Removed Linux bypass route for ${ip}`);
      success = true;
    }
    activeBypassIps = activeBypassIps.filter(x => x !== ip);
    return success;
  } catch (err) {
    getLogger().warn(`[RouteManager] Failed to remove bypass route for ${ip} (might already be deleted): ${err.message}`);
    activeBypassIps = activeBypassIps.filter(x => x !== ip);
  }
  return false;
}

/**
 * Clears all added bypass routes.
 */
async function clearAllBypasses() {
  const ips = [...activeBypassIps];
  for (const ip of ips) {
    await removeBypassRoute(ip);
  }
  activeBypassIps = [];
}

/**
 * Configures network interfaces and default route overrides on Linux.
 */
async function setupLinuxTunRouting(interfaceName) {
  if (!isLinux) return;
  try {
    // Bring link up
    await execPromise(`ip link set dev ${interfaceName} up`);
    // Assign tunnel address
    await execPromise(`ip addr add 10.0.9.1/24 dev ${interfaceName}`);
    // Override default route using 0.0.0.0/1 and 128.0.0.0/1
    await execPromise(`ip route add 0.0.0.0/1 dev ${interfaceName}`);
    await execPromise(`ip route add 128.0.0.0/1 dev ${interfaceName}`);
    getLogger().info(`[RouteManager] Configured Linux TUN routing for interface ${interfaceName}`);
  } catch (err) {
    getLogger().error(`[RouteManager] Linux TUN routing config failed: ${err.message}`);
    throw err;
  }
}

/**
 * Clears network interfaces and default route overrides on Linux.
 */
async function tearDownLinuxTunRouting(interfaceName) {
  if (!isLinux) return;
  try {
    try {
      await execPromise(`ip route del 0.0.0.0/1 dev ${interfaceName}`);
    } catch(e) {}
    try {
      await execPromise(`ip route del 128.0.0.0/1 dev ${interfaceName}`);
    } catch(e) {}
    getLogger().info(`[RouteManager] Restored Linux TUN routing for interface ${interfaceName}`);
  } catch (err) {
    getLogger().warn(`[RouteManager] Linux TUN routing teardown warning: ${err.message}`);
  }
}

module.exports = {
  getDefaultGateway,
  addBypassRoute,
  removeBypassRoute,
  clearAllBypasses,
  setupLinuxTunRouting,
  tearDownLinuxTunRouting
};
