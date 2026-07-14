const forge = require('node-forge');
const fs = require('fs');
const path = require('path');
const { getLogger } = require('./logger');

const CERT_PATH = path.join(process.cwd(), 'cert.pem');
const KEY_PATH = path.join(process.cwd(), 'key.pem');

function generateCertificates(cn) {
  const logger = getLogger();
  
  if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
    logger.info('TLS Certificates already exist, skipping generation.');
    return;
  }

  logger.info('No TLS Certificates found. Generating new 1000-year self-signed certificates...');
  
  const commonName = cn || 'mail.qq.com';
  
  const keys = forge.pki.rsa.generateKeyPair(2048);
  
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  
  const notAfter = new Date();
  notAfter.setFullYear(notAfter.getFullYear() + 1000);
  cert.validity.notAfter = notAfter;
  
  const attrs = [{
    name: 'commonName',
    value: commonName
  }, {
    name: 'organizationName',
    value: 'IT Department'
  }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  
  cert.sign(keys.privateKey);
  
  const pemCert = forge.pki.certificateToPem(cert);
  const pemKey = forge.pki.privateKeyToPem(keys.privateKey);
  
  fs.writeFileSync(CERT_PATH, pemCert);
  fs.writeFileSync(KEY_PATH, pemKey);
  
  logger.info('Certificates successfully generated and saved.');
}

function getCertificates(cn) {
  if (!fs.existsSync(CERT_PATH) || !fs.existsSync(KEY_PATH)) {
    generateCertificates(cn);
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
