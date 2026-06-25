const net = require('net');
const server = net.createServer(socket => {
  socket.once('data', d => {
    const str = d.toString();
    if (str.startsWith('CONNECT')) {
      const headerEnd = d.indexOf('\r\n\r\n');
      const leftover = headerEnd !== -1 && headerEnd + 4 < d.length ? d.slice(headerEnd + 4) : Buffer.alloc(0);
      const out = new net.Socket();
      out.connect(443, 'cn.bing.com', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (leftover.length > 0) out.write(leftover);
        socket.pipe(out);
        out.pipe(socket);
      });
      out.on('error', e => console.error('out error:', e.message));
    }
  });
});
server.listen(1115, () => console.log('Proxy on 1115'));
