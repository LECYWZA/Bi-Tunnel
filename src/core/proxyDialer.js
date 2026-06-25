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
    const onData = (data) => {
      // 1. Auth reply
      if (data.length === 2 && data[0] === 0x05) {
        if (data[1] === 0x00) {
          // No auth required
          sendRequest();
        } else if (data[1] === 0x02) {
          // Username/Password auth required
          if (!user && !pass) {
             socket.removeListener('data', onData);
             return callback(new Error('SOCKS5 requires auth but no credentials provided'));
          }
          const uBuf = Buffer.from(user || '');
          const pBuf = Buffer.from(pass || '');
          const authReq = Buffer.concat([Buffer.from([0x01, uBuf.length]), uBuf, Buffer.from([pBuf.length]), pBuf]);
          socket.write(authReq);
        } else {
          socket.removeListener('data', onData);
          callback(new Error('SOCKS5 server denied accepted auth methods'));
        }
      } 
      // 2. Auth result
      else if (data.length === 2 && data[0] === 0x01) {
        if (data[1] === 0x00) {
          sendRequest();
        } else {
          socket.removeListener('data', onData);
          callback(new Error('SOCKS5 auth failed'));
        }
      }
      // 3. Request result
      else if (data.length >= 10 && data[0] === 0x05) {
        socket.removeListener('data', onData);
        if (data[1] === 0x00) {
          callback(null); // Success
        } else {
          callback(new Error(`SOCKS5 connection to target failed with code: ${data[1]}`));
        }
      }
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
      const req = Buffer.concat([Buffer.from([0x05, 0x01, 0x00, atyp]), hostBuf, portBuf]);
      socket.write(req);
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
