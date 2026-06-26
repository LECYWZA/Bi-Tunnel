const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { getLogger } = require('../utils/logger');
const { XRAY_EXE, BIN_DIR } = require('../utils/xrayDownloader');

let currentXrayProcess = null;
let currentListenPort = 0;
let currentV2rayUrl = null;
let startingPromise = null;

async function getFreePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
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
  if (currentXrayProcess && currentV2rayUrl === v2rayNode.rawUrl && currentListenPort > 0) {
    return currentListenPort;
  }

  if (startingPromise) {
    // If it's already starting, wait for it
    if (currentV2rayUrl === v2rayNode.rawUrl) {
      return startingPromise;
    }
    // If starting a different one, wait for the previous start to finish before killing
    await startingPromise;
  }

  startingPromise = (async () => {
    if (currentXrayProcess) {
      currentXrayProcess.kill();
      currentXrayProcess = null;
    }

    currentV2rayUrl = v2rayNode.rawUrl;
    const localPort = await getFreePort();
    
    let outbound;
    try {
      if (v2rayNode.rawUrl.startsWith('vmess://')) {
        outbound = parseVmess(v2rayNode.rawUrl);
      } else if (v2rayNode.rawUrl.startsWith('vless://')) {
        outbound = parseVless(v2rayNode.rawUrl);
      } else {
        throw new Error('Unsupported v2ray protocol: ' + v2rayNode.rawUrl.split(':')[0]);
      }
    } catch (err) {
      getLogger().error(`[Xray] Failed to parse node config: ${err.message}`);
      return null;
    }

    const config = {
      log: { loglevel: 'warning' },
      inbounds: [{
        port: localPort,
        listen: '127.0.0.1',
        protocol: 'socks',
        settings: { auth: 'noauth', udp: true }
      }],
      outbounds: [outbound]
    };

    const configPath = path.join(BIN_DIR, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    return new Promise((resolve, reject) => {
      getLogger().info(`[Xray] Starting xray-core on local SOCKS5 port ${localPort}...`);
      currentXrayProcess = spawn(XRAY_EXE, ['run', '-c', configPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });

      let errorLogs = '';
      currentXrayProcess.stderr.on('data', (data) => {
        const msg = data.toString();
        errorLogs += msg;
        getLogger().error(`[Xray Core] ${msg.trim()}`);
      });
      currentXrayProcess.stdout.on('data', (data) => {
        const msg = data.toString();
        errorLogs += msg;
        getLogger().info(`[Xray Core] ${msg.trim()}`);
      });

      let isResolved = false;

      currentXrayProcess.on('error', (err) => {
        getLogger().error(`[Xray] Process error: ${err.message}`);
        currentListenPort = 0;
        currentV2rayUrl = null;
        if (!isResolved) {
          isResolved = true;
          reject(new Error(`Failed to start Xray: ${err.message}`));
        }
      });

      currentXrayProcess.on('exit', (code) => {
        getLogger().error(`[Xray] Process exited with code ${code}`);
        currentListenPort = 0;
        currentV2rayUrl = null;
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
            currentListenPort = localPort;
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

  const port = await startingPromise;
  startingPromise = null;
  return port;
}
function getActiveXrayPort() {
  return currentListenPort;
}

function stopXray() {
  if (currentXrayProcess) {
    currentXrayProcess.kill();
    currentXrayProcess = null;
    currentListenPort = 0;
    currentV2rayUrl = null;
    getLogger().info('[Xray] Process stopped.');
  }
}

function getStatus() {
  return {
    running: !!currentXrayProcess,
    pid: currentXrayProcess ? currentXrayProcess.pid : null,
    port: currentListenPort,
    url: currentV2rayUrl
  };
}

module.exports = { startXray, stopXray, getActiveXrayPort, getStatus };
