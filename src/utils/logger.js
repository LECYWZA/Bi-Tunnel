const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const configManager = require('../config/config');
const path = require('path');

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(info => `[${info.timestamp}] ${info.level.toUpperCase()}: ${info.message}`)
);

let logger = null;

function initLogger() {
  const config = configManager.getConfig().logConfig || { maxDays: 14, maxSizeMB: 20 };
  
  const transport = new DailyRotateFile({
    filename: path.join(process.cwd(), 'logs', 'application-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: `${config.maxSizeMB}m`,
    maxFiles: `${config.maxDays}d`
  });

  logger = winston.createLogger({
    level: 'info',
    format: logFormat,
    transports: [
      new winston.transports.Console(),
      transport
    ]
  });
  
  return logger;
}

function getLogger() {
  if (!logger) {
    return initLogger();
  }
  return logger;
}

// Function to safely log traffic sizes
function logTraffic(type, info, bytes) {
  if (bytes > 0) {
    getLogger().info(`[Traffic] ${type} | ${info} | Transferred: ${(bytes / 1024).toFixed(2)} KB`);
  }
}

module.exports = {
  initLogger,
  getLogger,
  logTraffic
};
