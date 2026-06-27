const net = require('net');
const { getLogger } = require('../utils/logger');

class ProxyDialer {
  /**
   * Connects to a target through a chain of proxies.
   * @param {Array} nodes Array of proxy configs: { type: 'socks5'|'http', host, port, user, pass }
   * @param {string} targetHost Final destination host
   * @param {number} targetPort Final destination port
   * @param {boolean} useRemoteNetwork Whether the first hop should go through Bi-Tunnel session
   * @param {Object} session The Bi-Tunnel session (if useRemoteNetwork is true)
   * @param {Function} callback (err, socket)
   */
  static dialChain(nodes, targetHost, targetPort, useRemoteNetwork, session, callback) {
    if (!nodes || nodes.length === 0) {
      return callback(new Error('Proxy chain is empty'));
    }

    // If chain contains multiple v2ray nodes, use Xray native chaining
    const v2rayCount = nodes.filter(n => n.type === 'v2ray').length;
    if (v2rayCount > 1) {
      return this.dialV2rayChain(nodes, targetHost, targetPort, callback);
    }

    const firstNode = nodes[0];
    let socket;

    const onFirstConnected = (s) => {
      this.handshakeChain(s, nodes, 0, targetHost, targetPort, (err, finalSocket) => {
        if (err) {
          s.destroy();
          callback(err);
        } else {
          callback(null, finalSocket);
        }
      });
    };

    const performDial = async () => {
      try {
        let connectHost = firstNode.host;
        let connectPort = firstNode.port;

        if (firstNode.type === 'v2ray') {
          const { startXray } = require('./xrayManager');
          const localPort = await startXray(firstNode);
          if (!localPort) throw new Error('Failed to start Xray process for first v2ray node');
          connectHost = '127.0.0.1';
          connectPort = localPort;
        }

        if (useRemoteNetwork) {
          if (!session) return callback(new Error('No remote session available'));
          socket = session.createChannel({
            type: 'forward',
            host: connectHost,
            port: connectPort
          });
          socket.once('error', (err) => {
             callback(new Error(`Remote tunnel error to first node: ${err.message}`));
          });
          process.nextTick(() => onFirstConnected(socket));
        } else {
          socket = new net.Socket();
          socket.connect(connectPort, connectHost, () => {
            socket.removeAllListeners('error');
            onFirstConnected(socket);
          });
          socket.once('error', (err) => {
            callback(new Error(`Failed to connect to first node ${connectHost}:${connectPort} - ${err.message}`));
          });
        }
      } catch (err) {
        callback(err);
      }
    };

    performDial();
  }

  /**
   * Dials through a chain of v2ray nodes using Xray's native proxySettings chaining.
   * Each v2ray node gets its own Xray process; subsequent nodes route through
   * the previous node's local SOCKS5 port via proxySettings.
   */
  static dialV2rayChain(nodes, targetHost, targetPort, callback) {
    const { startXray } = require('./xrayManager');

    (async () => {
      try {
        let prevSocksPort = null;

        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          if (node.type === 'v2ray') {
            getLogger().info(`[ProxyChain] Starting Xray for node ${i + 1}/${nodes.length} (${node.displayName || node.host})${prevSocksPort ? ' via port ' + prevSocksPort : ' (direct)'}`);
            const localPort = await startXray(node, prevSocksPort);
            if (!localPort) throw new Error(`Failed to start Xray for chain node ${i + 1}`);
            prevSocksPort = localPort;
          } else {
            throw new Error(`Non-v2ray node at position ${i} is not supported in multi-v2ray chain mode`);
          }
        }

        // Connect to the last Xray's local SOCKS5 port and handshake to target
        const finalPort = prevSocksPort;
        const socket = new net.Socket();
        socket.connect(finalPort, '127.0.0.1', () => {
          socket.removeAllListeners('error');
          this.handshakeSocks5(socket, '', '', targetHost, targetPort, (err) => {
            if (err) {
              socket.destroy();
              return callback(err);
            }
            callback(null, socket);
          });
        });
        socket.once('error', (err) => {
          callback(new Error(`Failed to connect to final Xray port ${finalPort}: ${err.message}`));
        });
      } catch (err) {
        callback(err);
      }
    })();
  }

  static handshakeChain(socket, nodes, currentIndex, finalHost, finalPort, callback) {
    if (currentIndex >= nodes.length) {
      // Reached the end of the chain, socket is now connected to final target
      return callback(null, socket);
    }

    const currentNode = nodes[currentIndex];
    const isLastNode = currentIndex === nodes.length - 1;
    const nextHost = isLastNode ? finalHost : nodes[currentIndex + 1].host;
    const nextPort = isLastNode ? finalPort : nodes[currentIndex + 1].port;

    getLogger().info(`[ProxyChain] Dialing through node ${currentIndex + 1}/${nodes.length} (${currentNode.type}://${currentNode.host}:${currentNode.port}) to ${nextHost}:${nextPort}`);

    if (currentNode.type === 'socks5') {
      this.handshakeSocks5(socket, currentNode.user, currentNode.pass, nextHost, nextPort, (err) => {
        if (err) return callback(err);
        this.handshakeChain(socket, nodes, currentIndex + 1, finalHost, finalPort, callback);
      });
    } else if (currentNode.type === 'http') {
      this.handshakeHttp(socket, currentNode.user, currentNode.pass, nextHost, nextPort, (err) => {
        if (err) return callback(err);
        this.handshakeChain(socket, nodes, currentIndex + 1, finalHost, finalPort, callback);
      });
    } else if (currentNode.type === 'v2ray') {
      if (currentIndex > 0) {
        return callback(new Error('v2ray nodes must be the FIRST node in the proxy chain. Chaining after another proxy is not supported.'));
      }
      // If it's the first node, dialChain already started it and connected to it via local SOCKS5 port
      // So we just perform a normal SOCKS5 handshake!
      this.handshakeSocks5(socket, '', '', nextHost, nextPort, (err) => {
        if (err) return callback(err);
        this.handshakeChain(socket, nodes, currentIndex + 1, finalHost, finalPort, callback);
      });
    } else {
      callback(new Error(`Unsupported proxy type: ${currentNode.type}`));
    }
  }

  static handshakeSocks5(socket, user, pass, targetHost, targetPort, callback) {
    let state = 'auth'; // 'auth' | 'auth_result' | 'request'
    let buffer = Buffer.alloc(0);

    const advanceState = () => {
      while (buffer.length > 0) {
        if (state === 'auth') {
          if (buffer.length < 2) return;
          if (buffer[0] !== 0x05) {
            socket.removeListener('data', onData);
            return callback(new Error('Invalid SOCKS5 auth reply'));
          }
          if (buffer[1] === 0x00) {
            buffer = buffer.slice(2);
            sendRequest();
            state = 'request';
          } else if (buffer[1] === 0x02) {
            buffer = buffer.slice(2);
            if (!user && !pass) {
              socket.removeListener('data', onData);
              return callback(new Error('SOCKS5 requires auth but no credentials provided'));
            }
            const uBuf = Buffer.from(user || '');
            const pBuf = Buffer.from(pass || '');
            socket.write(Buffer.concat([Buffer.from([0x01, uBuf.length]), uBuf, Buffer.from([pBuf.length]), pBuf]));
            state = 'auth_result';
          } else {
            socket.removeListener('data', onData);
            return callback(new Error('SOCKS5 server denied accepted auth methods'));
          }
        } else if (state === 'auth_result') {
          if (buffer.length < 2) return;
          if (buffer[0] !== 0x01) {
            socket.removeListener('data', onData);
            return callback(new Error('Invalid SOCKS5 auth result'));
          }
          if (buffer[1] === 0x00) {
            buffer = buffer.slice(2);
            sendRequest();
            state = 'request';
          } else {
            socket.removeListener('data', onData);
            return callback(new Error('SOCKS5 auth failed'));
          }
        } else if (state === 'request') {
          if (buffer.length < 10) return;
          if (buffer[0] !== 0x05) {
            socket.removeListener('data', onData);
            return callback(new Error('Invalid SOCKS5 request reply'));
          }
          let replyLen = 10;
          if (buffer[3] === 0x01) {
            replyLen = 10;
          } else if (buffer[3] === 0x03) {
            if (buffer.length < 5) return;
            const domainLen = buffer[4];
            replyLen = 5 + domainLen + 2;
          } else if (buffer[3] === 0x04) {
            replyLen = 22;
          } else {
            socket.removeListener('data', onData);
            return callback(new Error('Unknown SOCKS5 address type: ' + buffer[3]));
          }
          if (buffer.length < replyLen) return;

          socket.removeListener('data', onData);
          if (buffer[1] === 0x00) {
            const extra = buffer.slice(replyLen);
            if (extra.length > 0) socket.unshift(extra);
            callback(null);
          } else {
            callback(new Error(`SOCKS5 connection to target failed with code: ${buffer[1]}`));
          }
          return;
        }
      }
    };

    const onData = (data) => {
      buffer = Buffer.concat([buffer, data]);
      advanceState();
    };

    const sendRequest = () => {
      let hostBuf;
      let atyp;
      if (net.isIPv4(targetHost)) {
        atyp = 0x01;
        hostBuf = Buffer.from(targetHost.split('.').map(Number));
      } else {
        atyp = 0x03;
        const hBuf = Buffer.from(targetHost);
        hostBuf = Buffer.concat([Buffer.from([hBuf.length]), hBuf]);
      }
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(targetPort, 0);
      socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, atyp]), hostBuf, portBuf]));
    };

    socket.on('data', onData);
    socket.once('error', (err) => {
      socket.removeListener('data', onData);
      callback(err);
    });

    // Start handshake
    const methods = (user || pass) ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]);
    socket.write(methods);
  }

  static handshakeHttp(socket, user, pass, targetHost, targetPort, callback) {
    let leftover = Buffer.alloc(0);
    
    const onData = (data) => {
      leftover = Buffer.concat([leftover, data]);
      const str = leftover.toString('utf8');
      const headerEnd = str.indexOf('\r\n\r\n');
      
      if (headerEnd !== -1) {
        socket.removeListener('data', onData);
        const headers = str.substring(0, headerEnd);
        const firstLine = headers.split('\r\n')[0];
        
        if (firstLine.includes('200')) {
          // If the proxy sent extra data, put it back onto the socket stream
          // In Node.js, we can emit 'data' or unshift
          const extra = leftover.slice(headerEnd + 4);
          if (extra.length > 0) {
            socket.unshift(extra);
          }
          callback(null);
        } else {
          callback(new Error(`HTTP Proxy rejected CONNECT: ${firstLine}`));
        }
      }
    };

    socket.on('data', onData);
    socket.once('error', (err) => {
      socket.removeListener('data', onData);
      callback(err);
    });

    let authHeader = '';
    if (user || pass) {
      const b64 = Buffer.from(`${user || ''}:${pass || ''}`).toString('base64');
      authHeader = `\r\nProxy-Authorization: Basic ${b64}`;
    }
    socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}${authHeader}\r\n\r\n`);
  }
}

module.exports = ProxyDialer;
