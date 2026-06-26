function parseProxyUrl(url) {
  try {
    if (!url || typeof url !== 'string') return null;
    
    // vmess://
    if (url.startsWith('vmess://')) {
      const base64str = url.replace('vmess://', '');
      const jsonStr = decodeURIComponent(escape(atob(base64str)));
      const vmessConfig = JSON.parse(jsonStr);
      return {
        type: 'v2ray',
        v2rayType: 'vmess',
        host: vmessConfig.add,
        port: parseInt(vmessConfig.port),
        rawUrl: url,
        displayName: vmessConfig.ps || `${vmessConfig.add}:${vmessConfig.port}`
      };
    }
    
    // vless://
    if (url.startsWith('vless://')) {
      const parsed = new URL(url);
      return {
        type: 'v2ray',
        v2rayType: 'vless',
        host: parsed.hostname,
        port: parseInt(parsed.port),
        rawUrl: url,
        displayName: decodeURIComponent(parsed.hash.replace('#', '')) || `${parsed.hostname}:${parsed.port}`
      };
    }

    // trojan://
    if (url.startsWith('trojan://')) {
      const parsed = new URL(url);
      return {
        type: 'v2ray',
        v2rayType: 'trojan',
        host: parsed.hostname,
        port: parseInt(parsed.port),
        rawUrl: url,
        displayName: decodeURIComponent(parsed.hash.replace('#', '')) || `${parsed.hostname}:${parsed.port}`
      };
    }

    // ss:// (Shadowsocks)
    if (url.startsWith('ss://')) {
      // ss urls can have user info base64 encoded
      const parsed = new URL(url);
      return {
        type: 'v2ray',
        v2rayType: 'shadowsocks',
        host: parsed.hostname,
        port: parseInt(parsed.port),
        rawUrl: url,
        displayName: decodeURIComponent(parsed.hash.replace('#', '')) || `${parsed.hostname}:${parsed.port}`
      };
    }

    // Standard HTTP/SOCKS5
    if (url.startsWith('http://') || url.startsWith('socks5://')) {
      const parsed = new URL(url);
      return {
        type: parsed.protocol.replace(':', ''),
        host: parsed.hostname,
        port: parseInt(parsed.port),
        user: parsed.username || '',
        pass: parsed.password || ''
      };
    }

    return null;
  } catch (e) {
    console.error('Failed to parse proxy URL:', e);
    return null;
  }
}

function decodeV2RayUrl(url) {
  try {
    if (!url) return null;
    if (url.startsWith('vmess://')) {
      const base64str = url.replace('vmess://', '');
      const jsonStr = decodeURIComponent(escape(atob(base64str)));
      const v = JSON.parse(jsonStr);
      return {
        v2rayType: 'vmess',
        displayName: v.ps || '',
        host: v.add || '',
        port: parseInt(v.port) || 443,
        uuid: v.id || '',
        network: v.net || 'tcp',
        path: v.path || '',
        tls: v.tls || 'none',
        sni: v.sni || v.host || '',
        _rawObj: v 
      };
    } else if (url.startsWith('vless://') || url.startsWith('trojan://') || url.startsWith('ss://')) {
      const parsed = new URL(url);
      const v2rayType = url.split('://')[0];
      const params = parsed.searchParams;
      return {
        v2rayType,
        displayName: decodeURIComponent(parsed.hash.replace('#', '')) || '',
        host: parsed.hostname || '',
        port: parseInt(parsed.port) || 443,
        uuid: parsed.username || '',
        network: params.get('type') || 'tcp',
        path: params.get('path') || '',
        tls: params.get('security') || 'none',
        sni: params.get('sni') || params.get('host') || parsed.hostname || '',
        alpn: params.get('alpn') || '',
        pbk: params.get('pbk') || '',
        sid: params.get('sid') || '',
        spx: params.get('spx') || ''
      };
    }
  } catch (e) {
    console.error('Decode failed:', e);
  }
  return null;
}

function encodeV2RayUrl(config) {
  try {
    if (config.v2rayType === 'vmess') {
      const v = config._rawObj || {};
      v.v = v.v || "2";
      v.ps = config.displayName;
      v.add = config.host;
      v.port = config.port.toString();
      v.id = config.uuid;
      v.net = config.network;
      v.path = config.path;
      v.tls = config.tls === 'none' ? '' : config.tls;
      v.sni = config.sni;
      if (config.network === 'ws') {
        v.host = config.sni || config.host; 
      }
      const jsonStr = JSON.stringify(v);
      const base64str = btoa(unescape(encodeURIComponent(jsonStr)));
      return 'vmess://' + base64str;
    } else {
      let url = `${config.v2rayType}://${config.uuid}@${config.host}:${config.port}`;
      const params = new URLSearchParams();
      if (config.network && config.network !== 'tcp') params.set('type', config.network);
      if (config.tls && config.tls !== 'none') params.set('security', config.tls);
      if (config.path) params.set('path', config.path);
      if (config.sni) params.set('sni', config.sni);
      if (config.alpn) params.set('alpn', config.alpn);
      if (config.pbk) params.set('pbk', config.pbk);
      if (config.sid) params.set('sid', config.sid);
      if (config.spx) params.set('spx', config.spx);
      
      const qs = params.toString();
      if (qs) url += '?' + qs;
      if (config.displayName) url += '#' + encodeURIComponent(config.displayName);
      return url;
    }
  } catch (e) {
    console.error('Encode failed:', e);
    return null;
  }
}

module.exports = {
  parseProxyUrl,
  decodeV2RayUrl,
  encodeV2RayUrl
};
