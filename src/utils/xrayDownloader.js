const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getLogger } = require('./logger');

const isLinux = os.platform() === 'linux';
const BIN_DIR = path.join(process.cwd(), 'bin');
const XRAY_EXE = path.join(BIN_DIR, isLinux ? 'xray' : 'xray.exe');
const DOWNLOAD_URL = isLinux 
  ? 'https://github.com/XTLS/Xray-core/releases/download/v1.8.23/Xray-linux-64.zip' 
  : 'https://github.com/XTLS/Xray-core/releases/download/v1.8.23/Xray-windows-64.zip';

async function downloadXray() {
  if (fs.existsSync(XRAY_EXE)) {
    return true; // Already downloaded
  }
  
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }

  // Try extracting from pkg snapshot if we are missing xray
  const pkgBinDir = path.join(__dirname, '../../bin');
  const pkgXray = path.join(pkgBinDir, isLinux ? 'xray' : 'xray.exe');
  
  if (fs.existsSync(pkgXray)) {
    getLogger().info('[Xray] Extracting bundled xray-core from package...');
    try {
      const files = fs.readdirSync(pkgBinDir);
      for (const file of files) {
        fs.copyFileSync(path.join(pkgBinDir, file), path.join(BIN_DIR, file));
      }
      if (isLinux) {
        fs.chmodSync(XRAY_EXE, '755');
      }
      getLogger().info('[Xray] Bundled extraction successful.');
      return true;
    } catch (e) {
      getLogger().warn('[Xray] Failed to extract from bundle, will attempt download. ' + e.message);
    }
  }

  getLogger().info(`[Xray] Downloading xray-core v1.8.23 from GitHub for ${isLinux ? 'Linux' : 'Windows'}, this might take a minute...`);
  
  const zipPath = path.join(BIN_DIR, 'xray.zip');
  
  return new Promise((resolve) => {
    if (isLinux) {
      const cmd = `wget -O "${zipPath}" "${DOWNLOAD_URL}" && unzip -o "${zipPath}" -d "${BIN_DIR}" && rm "${zipPath}" && chmod +x "${XRAY_EXE}"`;
      exec(cmd, (err) => {
        if (err || !fs.existsSync(XRAY_EXE)) {
          getLogger().error(`[Xray] Download failed: ${err ? err.message : 'Executable not found'}`);
          resolve(false);
        } else {
          getLogger().info('[Xray] Successfully downloaded and extracted xray-core.');
          resolve(true);
        }
      });
    } else {
      const psCommand = `
        $ErrorActionPreference = 'Stop';
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;
        Invoke-WebRequest -Uri '${DOWNLOAD_URL}' -OutFile '${zipPath}';
        Expand-Archive -Path '${zipPath}' -DestinationPath '${BIN_DIR}' -Force;
        Remove-Item '${zipPath}';
      `;
      exec(`powershell -Command "${psCommand.replace(/\n/g, ' ')}"`, (err) => {
        if (err || !fs.existsSync(XRAY_EXE)) {
          getLogger().error(`[Xray] Download failed: ${err ? err.message : 'Executable not found'}`);
          resolve(false);
        } else {
          getLogger().info('[Xray] Successfully downloaded and extracted xray-core.');
          resolve(true);
        }
      });
    }
  });
}

module.exports = { downloadXray, XRAY_EXE, BIN_DIR };
