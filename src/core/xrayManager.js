const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { getLogger } = require('../utils/logger');
const { XRAY_EXE, BIN_DIR } = require('../utils/xrayDownloader');

const activeXrays = new Map(); // rawUrl -> { process, port, lastUsed }
const startingPromises = new Map(); // rawUrl -> Promise
const reservedPorts = new Set();
let currentV2rayUrl = null;

let currentTunProcess = null;
let currentTunPort = 0;
let currentTunError = null;

async function getFreePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => {
        if (reservedPorts.has(port)) {
          resolve(getFreePort());
        } else {
          reservedPorts.add(port);
          setTimeout(() => reservedPorts.delete(port), 5000);
          resolve(port);
        }
      });
    });
  });
}

function parseVmess(rawUrl) {
  const base64str = rawUrl.replace('vmess://', '');
  const vmess = JSON.parse(decodeURIComponent(escape(atob(base64str))));
  
  const streamSettings = {
    network: vmess.net || 'tcp',
    security: vmess.tls === 'tls' ? 'tls' : 'none',
  };

  if (vmess.tls === 'tls') {
    streamSettings.tlsSettings = {
      serverName: vmess.sni || vmess.host || vmess.add,
      allowInsecure: vmess.allowInsecure === true || vmess.allowInsecure === 'true' || vmess.allowInsecure === '1',
    };
    if (vmess.alpn) {
      streamSettings.tlsSettings.alpn = vmess.alpn.split(',');
    }
    if (vmess.fp) {
      streamSettings.tlsSettings.fingerprint = vmess.fp;
    }
  }

  if (vmess.net === 'ws') {
    streamSettings.wsSettings = {
      path: vmess.path || '/',
      headers: {
        Host: vmess.host || vmess.add
      }
    };
  } else if (vmess.net === 'grpc') {
    streamSettings.grpcSettings = {
      serviceName: vmess.path || '',
      multiMode: false
    };
  }

  return {
    protocol: 'vmess',
    settings: {
      vnext: [{
        address: vmess.add,
        port: parseInt(vmess.port),
        users: [{
          id: vmess.id,
          alterId: parseInt(vmess.aid) || 0,
          security: vmess.scy || 'auto'
        }]
      }]
    },
    streamSettings
  };
}

function parseVless(rawUrl) {
  const parsed = new URL(rawUrl);
  const uuid = parsed.username;
  const host = parsed.hostname;
  const port = parseInt(parsed.port);
  const params = parsed.searchParams;

  const streamSettings = {
    network: params.get('type') || 'tcp',
    security: params.get('security') || 'none',
  };

  if (streamSettings.security === 'tls' || streamSettings.security === 'reality') {
    streamSettings.tlsSettings = {
      serverName: params.get('sni') || host,
      alpn: params.get('alpn') ? params.get('alpn').split(',') : undefined,
      fingerprint: params.get('fp') || 'chrome'
    };
    if (streamSettings.security === 'reality') {
      streamSettings.realitySettings = {
        serverName: params.get('sni') || host,
        publicKey: params.get('pbk'),
        shortId: params.get('sid') || '',
        spiderX: params.get('spx') || '/',
        fingerprint: params.get('fp') || 'chrome'
      };
    }
  }

  if (streamSettings.network === 'ws') {
    streamSettings.wsSettings = {
      path: params.get('path') || '/',
      headers: { Host: params.get('host') || host }
    };
  } else if (streamSettings.network === 'grpc') {
    streamSettings.grpcSettings = {
      serviceName: params.get('serviceName') || '',
      multiMode: params.get('mode') === 'multi'
    };
  }

  return {
    protocol: 'vless',
    settings: {
      vnext: [{
        address: host,
        port: port,
        users: [{
          id: uuid,
          encryption: params.get('encryption') || 'none',
          flow: params.get('flow') || ''
        }]
      }]
    },
    streamSettings
  };
}

async function startXray(v2rayNode) {
  const rawUrl = v2rayNode.rawUrl;
  
  // Update current active proxy url on start
  currentV2rayUrl = rawUrl;

  // Check if already active and running
  if (activeXrays.has(rawUrl)) {
    const item = activeXrays.get(rawUrl);
    item.lastUsed = Date.now();
    return item.port;
  }

  // Check if it's already starting
  let startingPromise = startingPromises.get(rawUrl);
  if (startingPromise) {
    return startingPromise;
  }

  startingPromise = (async () => {
    const localPort = await getFreePort();
    
    let outbound;
    try {
      if (rawUrl.startsWith('vmess://')) {
        outbound = parseVmess(rawUrl);
      } else if (rawUrl.startsWith('vless://')) {
        outbound = parseVless(rawUrl);
      } else {
        throw new Error('Unsupported v2ray protocol: ' + rawUrl.split(':')[0]);
      }
    } catch (err) {
      getLogger().error(`[Xray] Failed to parse node config: ${err.message}`);
      startingPromises.delete(rawUrl);
      return null;
    }

    const config = {
      log: { loglevel: 'warning' },
      inbounds: [{
        port: localPort,
        listen: '127.0.0.1',
        protocol: 'socks',
        settings: { auth: 'noauth', udp: false }
      }],
      outbounds: [outbound]
    };

    const configPath = path.join(BIN_DIR, `config-${localPort}.json`);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    return new Promise((resolve, reject) => {
      getLogger().info(`[Xray] Starting xray-core on local SOCKS5 port ${localPort}...`);
      const proc = spawn(XRAY_EXE, ['run', '-c', configPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });

      let errorLogs = '';
      proc.stderr.on('data', (data) => {
        const msg = data.toString();
        errorLogs += msg;
        getLogger().error(`[Xray Core ${localPort}] ${msg.trim()}`);
      });
      proc.stdout.on('data', (data) => {
        const msg = data.toString();
        errorLogs += msg;
        getLogger().info(`[Xray Core ${localPort}] ${msg.trim()}`);
      });

      let isResolved = false;

      proc.on('error', (err) => {
        getLogger().error(`[Xray ${localPort}] Process error: ${err.message}`);
        try { fs.unlinkSync(configPath); } catch(e) {}
        activeXrays.delete(rawUrl);
        startingPromises.delete(rawUrl);
        if (!isResolved) {
          isResolved = true;
          reject(err);
        }
      });

      proc.on('exit', (code) => {
        getLogger().info(`[Xray ${localPort}] Process exited with code ${code}`);
        try { fs.unlinkSync(configPath); } catch(e) {}
        activeXrays.delete(rawUrl);
        startingPromises.delete(rawUrl);
        if (!isResolved) {
          isResolved = true;
          reject(new Error(`Xray exited prematurely: ${errorLogs || 'Unknown error'}`));
        }
      });

      // Poll port to see if it's listening
      const checkPort = () => {
        if (isResolved) return;
        const sock = new net.Socket();
        sock.setTimeout(500);
        sock.on('connect', () => {
          sock.destroy();
          if (!isResolved) {
            isResolved = true;
            activeXrays.set(rawUrl, {
              process: proc,
              port: localPort,
              lastUsed: Date.now()
            });
            startingPromises.delete(rawUrl);
            resolve(localPort);
          }
        });
        sock.on('error', () => {
          sock.destroy();
          if (!isResolved) setTimeout(checkPort, 100);
        });
        sock.on('timeout', () => {
          sock.destroy();
          if (!isResolved) setTimeout(checkPort, 100);
        });
        sock.connect(localPort, '127.0.0.1');
      };

      checkPort();
    });
  })();

  startingPromises.set(rawUrl, startingPromise);
  try {
    const port = await startingPromise;
    return port;
  } catch (err) {
    startingPromises.delete(rawUrl);
    throw err;
  }
}

function getActiveXrayPort() {
  if (currentV2rayUrl && activeXrays.has(currentV2rayUrl)) {
    return activeXrays.get(currentV2rayUrl).port;
  }
  return 0;
}

function stopXray() {
  currentV2rayUrl = null;
  for (const [rawUrl, item] of activeXrays.entries()) {
    try { item.process.kill(); } catch(e) {}
  }
  activeXrays.clear();
  startingPromises.clear();
  getLogger().info('[Xray] All processes stopped.');
}

function getStatus() {
  const activeItem = currentV2rayUrl ? activeXrays.get(currentV2rayUrl) : null;
  return {
    running: !!activeItem,
    pid: activeItem ? activeItem.process.pid : null,
    port: activeItem ? activeItem.port : 0,
    url: currentV2rayUrl
  };
}

// Cleanup timer for idle processes
setInterval(() => {
  const now = Date.now();
  const idleTimeout = 5 * 60 * 1000; // 5 minutes
  for (const [rawUrl, item] of activeXrays.entries()) {
    if (rawUrl === currentV2rayUrl) continue;
    if (now - item.lastUsed > idleTimeout) {
      getLogger().info(`[Xray] Cleaning up idle xray process on port ${item.port} for node...`);
      try { item.process.kill(); } catch(e) {}
      activeXrays.delete(rawUrl);
    }
  }
}, 30000);

async function startTun(proxyPort) {
  const os = require('os');
  if (currentTunProcess) {
    if (currentTunPort === proxyPort) {
      return { success: true, port: proxyPort };
    }
    await stopTun();
  }

  currentTunPort = proxyPort;
  currentTunError = null;

  const config = {
    log: { loglevel: 'warning' },
    dns: {
      // TCP DNS through proxy chain to bypass GFW DNS pollution
      servers: [
        "tcp://1.1.1.1:53",
        "tcp://8.8.8.8:53"
      ],
      // Force IPv4-only DNS results (TUN has no IPv6 route configured)
      queryStrategy: "UseIPv4"
    },
    inbounds: [
      {
        "tag": "tun-in",
        "protocol": "tun",
        "port": 0,
        "settings": {
          "name": "tun-bi",
          "mtu": 1500,
          "gateway": ["10.0.9.1/24"],
          "dns": ["1.1.1.1"],
          "autoSystemRoutingTable": ["0.0.0.0/0"],
          "autoOutboundsInterface": "auto"
        },
        "sniffing": {
          "enabled": true,
          "destOverride": ["http", "tls", "quic"],
          "routeOnly": false
        }
      }
    ],
    outbounds: [
      {
        "tag": "socks-out",
        "protocol": "socks",
        "settings": {
          "servers": [
            {
              "address": "127.0.0.1",
              "port": proxyPort
            }
          ]
        }
      },
      {
        "tag": "block",
        "protocol": "blackhole",
        "settings": {}
      },
      {
        "tag": "direct",
        "protocol": "freedom",
        "settings": {}
      },
      {
        "tag": "dns-out",
        "protocol": "dns",
        "settings": {}
      }
    ],
    "routing": {
      "domainStrategy": "AsIs",
      "rules": [
        {
          "type": "field",
          "inboundTag": ["tun-in"],
          "port": 53,
          "outboundTag": "dns-out"
        },
        {
          "type": "field",
          "inboundTag": ["tun-in"],
          "port": 137,
          "outboundTag": "block"
        },
        {
          "type": "field",
          "inboundTag": ["tun-in"],
          "port": 138,
          "outboundTag": "block"
        },
        {
          "type": "field",
          "inboundTag": ["tun-in"],
          "port": 139,
          "outboundTag": "block"
        },
        {
          "type": "field",
          "ip": [
            "10.0.0.0/8",
            "172.16.0.0/12",
            "192.168.0.0/16",
            "169.254.0.0/16",
            "127.0.0.0/8",
            "224.0.0.0/4",
            "255.255.255.255/32",
            "::1/128",
            "fc00::/7",
            "fe80::/10"
          ],
          "outboundTag": "direct"
        }
      ]
    }
  };

  const configPath = path.join(BIN_DIR, 'tun-config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  return new Promise(async (resolve, reject) => {
    getLogger().info(`[Xray TUN] Starting xray-core in TUN mode pointing to SOCKS5 port ${proxyPort}...`);
    
    const routeManager = require('../utils/routeManager');
    if (os.platform() === 'linux') {
      try {
        await routeManager.tearDownLinuxTunRouting('tun-bi');
      } catch(e) {}
    }

    currentTunProcess = spawn(XRAY_EXE, ['run', '-c', configPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    let errorLogs = '';
    let isResolved = false;

    currentTunProcess.stderr.on('data', (data) => {
      const msg = data.toString();
      errorLogs += msg;
      getLogger().error(`[Xray TUN Core] ${msg.trim()}`);
    });
    
    currentTunProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      errorLogs += msg;
      getLogger().info(`[Xray TUN Core] ${msg.trim()}`);
    });

    currentTunProcess.on('error', (err) => {
      getLogger().error(`[Xray TUN] Process error: ${err.message}`);
      currentTunError = err.message;
      currentTunPort = 0;
      if (!isResolved) {
        isResolved = true;
        reject(err);
      }
    });

    currentTunProcess.on('exit', (code) => {
      getLogger().error(`[Xray TUN] Process exited with code ${code}`);
      if (!currentTunProcess) {
        currentTunPort = 0;
        currentTunError = null;
        return;
      }
      
      currentTunPort = 0;
      currentTunProcess = null;
      
      let friendlyError = 'Xray exited prematurely';
      if (errorLogs.includes('permission denied') || errorLogs.includes('WintunCreateAdapter') || errorLogs.includes('create TUN') || errorLogs.includes('operation not permitted')) {
        friendlyError = '权限不足，请使用管理员/Root权限运行程序以创建虚拟网卡';
      } else if (errorLogs.trim()) {
        friendlyError = errorLogs.trim();
      }
      
      currentTunError = friendlyError;
      if (!isResolved) {
        isResolved = true;
        reject(new Error(friendlyError));
      }
    });

    // Wait a bit and check if Xray is still running
    setTimeout(async () => {
      if (isResolved) return;
      if (currentTunProcess && currentTunProcess.pid) {
        if (os.platform() === 'linux') {
          try {
            await routeManager.setupLinuxTunRouting('tun-bi');
          } catch (err) {
            getLogger().error(`[Xray TUN] Linux route setup failed: ${err.message}`);
            currentTunError = `路由配置失败: ${err.message}`;
            try { currentTunProcess.kill(); } catch(e) {}
            if (!isResolved) {
              isResolved = true;
              reject(err);
            }
            return;
          }
        } else if (os.platform() === 'win32') {
          try {
            await routeManager.setupWindowsTunRouting('tun-bi');
          } catch (err) {
            getLogger().error(`[Xray TUN] Windows route setup failed: ${err.message}`);
            currentTunError = `路由配置失败: ${err.message}`;
            try { currentTunProcess.kill(); } catch(e) {}
            if (!isResolved) {
              isResolved = true;
              reject(err);
            }
            return;
          }
        }
        isResolved = true;
        resolve({ success: true, port: proxyPort });
      } else {
        if (!isResolved) {
          isResolved = true;
          reject(new Error(currentTunError || 'Failed to start TUN process'));
        }
      }
    }, 3000);
  });
}

async function stopTun() {
  if (currentTunProcess) {
    const routeManager = require('../utils/routeManager');
    const os = require('os');
    if (os.platform() === 'linux') {
      try {
        await routeManager.tearDownLinuxTunRouting('tun-bi');
      } catch(e) {}
    } else if (os.platform() === 'win32') {
      try {
        await routeManager.tearDownWindowsTunRouting('tun-bi');
      } catch(e) {}
    }
    const proc = currentTunProcess;
    currentTunProcess = null; // Set to null before killing to mark as intentional stop
    proc.kill();
    currentTunPort = 0;
    currentTunError = null;
    getLogger().info('[Xray TUN] Process stopped and routing cleared.');
  }
}

function getTunStatus() {
  return {
    running: !!currentTunProcess,
    pid: currentTunProcess ? currentTunProcess.pid : null,
    port: currentTunPort,
    error: currentTunError
  };
}

module.exports = {
  startXray,
  stopXray,
  getActiveXrayPort,
  getStatus,
  startTun,
  stopTun,
  getTunStatus
};
