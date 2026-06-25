const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getLogger } = require('./logger');

const BIN_DIR = path.join(__dirname, '../../bin');
const XRAY_EXE = path.join(BIN_DIR, 'xray.exe');
const DOWNLOAD_URL = 'https://github.com/XTLS/Xray-core/releases/download/v1.8.23/Xray-windows-64.zip';

async function downloadXray() {
  if (fs.existsSync(XRAY_EXE)) {
    return true; // Already downloaded
  }
  
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }

  getLogger().info('[Xray] Downloading xray-core v1.8.23 from GitHub, this might take a minute...');
  
  const zipPath = path.join(BIN_DIR, 'xray.zip');
  
  // Use powershell to download and extract since we are on Windows
  const psCommand = `
    $ErrorActionPreference = 'Stop';
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;
    Invoke-WebRequest -Uri '${DOWNLOAD_URL}' -OutFile '${zipPath}';
    Expand-Archive -Path '${zipPath}' -DestinationPath '${BIN_DIR}' -Force;
    Remove-Item '${zipPath}';
  `;

  return new Promise((resolve) => {
    exec(`powershell -Command "${psCommand.replace(/\n/g, ' ')}"`, (err) => {
      if (err || !fs.existsSync(XRAY_EXE)) {
        getLogger().error(`[Xray] Download failed: ${err ? err.message : 'Executable not found'}`);
        // If download fails, we shouldn't crash, just log it so the user knows
        resolve(false);
      } else {
        getLogger().info('[Xray] Successfully downloaded and extracted xray-core.');
        resolve(true);
      }
    });
  });
}

module.exports = { downloadXray, XRAY_EXE, BIN_DIR };
