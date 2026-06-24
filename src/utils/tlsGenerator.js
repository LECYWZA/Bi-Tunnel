const forge = require('node-forge');
const fs = require('fs');
const path = require('path');
const { getLogger } = require('./logger');

const CERT_PATH = path.join(process.cwd(), 'cert.pem');
const KEY_PATH = path.join(process.cwd(), 'key.pem');

function generateCertificates() {
  const logger = getLogger();
  
  if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
    logger.info('TLS Certificates already exist, skipping generation.');
    return;
  }

  logger.info('No TLS Certificates found. Generating new 1000-year self-signed certificates...');
  
  // Generate keypair
  const keys = forge.pki.rsa.generateKeyPair(2048);
  
  // Create certificate
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  
  // Valid for 1000 years
  const notAfter = new Date();
  notAfter.setFullYear(notAfter.getFullYear() + 1000);
  cert.validity.notAfter = notAfter;
  
  const attrs = [{
    name: 'commonName',
    value: 'Bi-Tunnel-Self-Signed'
  }, {
    name: 'organizationName',
    value: 'Bi-Tunnel Secure'
  }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  
  // Self-sign certificate
  cert.sign(keys.privateKey);
  
  // Convert to PEM
  const pemCert = forge.pki.certificateToPem(cert);
  const pemKey = forge.pki.privateKeyToPem(keys.privateKey);
  
  // Save to disk
  fs.writeFileSync(CERT_PATH, pemCert);
  fs.writeFileSync(KEY_PATH, pemKey);
  
  logger.info('Certificates successfully generated and saved.');
}

function getCertificates() {
  if (!fs.existsSync(CERT_PATH) || !fs.existsSync(KEY_PATH)) {
    generateCertificates();
  }
  return {
    cert: fs.readFileSync(CERT_PATH),
    key: fs.readFileSync(KEY_PATH)
  };
}

module.exports = {
  generateCertificates,
  getCertificates
};
