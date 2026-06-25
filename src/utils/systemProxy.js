const { exec } = require('child_process');
const { getLogger } = require('./logger');

let previousProxyState = null;

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

async function getRegistryValue(name) {
  try {
    const stdout = await execPromise(`reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ${name}`);
    const match = stdout.match(/REG_(SZ|DWORD)\s+([^\r\n]+)/);
    if (match) {
      const val = match[2].trim();
      return match[1] === 'DWORD' ? parseInt(val, 16) : val;
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function enableSystemProxy(host, port) {
  try {
    // Backup previous state if not already backed up
    if (!previousProxyState) {
      previousProxyState = {
        ProxyEnable: await getRegistryValue('ProxyEnable'),
        ProxyServer: await getRegistryValue('ProxyServer'),
        ProxyOverride: await getRegistryValue('ProxyOverride')
      };
    }

    const proxyAddr = `${host}:${port}`;
    const bypassList = '<local>;localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*';

    await execPromise(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "${proxyAddr}" /f`);
    await execPromise(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyOverride /t REG_SZ /d "${bypassList}" /f`);
    await execPromise(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f`);
    
    // Refresh the system proxy settings (notify OS)
    // Note: To perfectly notify Windows immediately without IE/Restart, you need InternetSetOption.
    // However, usually registry change is picked up by modern apps immediately.
    
    getLogger().info(`[SystemProxy] Enabled global proxy -> ${proxyAddr}`);
    return true;
  } catch (err) {
    getLogger().error(`[SystemProxy] Failed to enable proxy: ${err.message}`);
    return false;
  }
}

async function disableSystemProxy() {
  try {
    if (previousProxyState && previousProxyState.ProxyEnable !== null) {
      await execPromise(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d ${previousProxyState.ProxyEnable || 0} /f`);
      if (previousProxyState.ProxyServer) {
        await execPromise(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "${previousProxyState.ProxyServer}" /f`);
      }
      if (previousProxyState.ProxyOverride) {
        await execPromise(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyOverride /t REG_SZ /d "${previousProxyState.ProxyOverride}" /f`);
      }
    } else {
      // Fallback to just disabling
      await execPromise(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f`);
    }
    
    // Clear state
    previousProxyState = null;
    getLogger().info('[SystemProxy] Disabled global proxy and restored previous state.');
    return true;
  } catch (err) {
    getLogger().error(`[SystemProxy] Failed to disable proxy: ${err.message}`);
    return false;
  }
}

module.exports = {
  enableSystemProxy,
  disableSystemProxy
};
