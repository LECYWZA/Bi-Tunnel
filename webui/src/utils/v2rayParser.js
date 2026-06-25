export function parseProxyUrl(url) {
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
