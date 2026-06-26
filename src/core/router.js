const geoip = require('geoip-lite');
const dns = require('dns').promises;
const ipaddr = require('ipaddr.js');

class Router {
  /**
   * Evaluates routing rules to determine the action for a given host
   * @param {string} host Target hostname or IP
   * @param {Array} rules Array of rules: { pattern: string, action: 'direct'|'proxy'|'block' }
   * @param {string} defaultAction Action if no rules match
   * @returns {Promise<{action: string, rulePattern: string}>} result
   */
  static async evaluate(host, rules, defaultAction = 'proxy') {
    if (!rules || !Array.isArray(rules)) return { action: defaultAction, rulePattern: '默认策略 (无规则)' };

    let resolvedIp = null;
    let ipResolved = false;

    const resolveIpIfNeeded = async () => {
      if (ipResolved) return;
      ipResolved = true;
      try {
        ipaddr.process(host);
        resolvedIp = host; // It is already an IP
      } catch (e) {
        try {
          // Resolve domain to IP
          const res = await dns.lookup(host);
          resolvedIp = res.address;
        } catch (err) {
          // Domain could not be resolved
        }
      }
    };

    for (const rule of rules) {
      const pattern = (rule.pattern || '').trim().toLowerCase();
      
      if (pattern.startsWith('geoip:')) {
        await resolveIpIfNeeded();
        if (resolvedIp) {
          const expectedCountry = pattern.substring(6).toUpperCase();
          const invert = expectedCountry.startsWith('!');
          const countryCode = invert ? expectedCountry.substring(1) : expectedCountry;
          
          // Allow internal/private IPs to be treated as CN to not route them via foreign proxy unexpectedly
          // But technically geoip-lite might return null for private IPs. We let the user handle local IPs via explicit rules or default actions.
          const geo = geoip.lookup(resolvedIp);
          const actualCountry = geo ? geo.country : null;
          
          if (invert) {
            if (actualCountry !== countryCode) return { action: rule.action, rulePattern: pattern };
          } else {
            if (actualCountry === countryCode) return { action: rule.action, rulePattern: pattern };
          }
        }
      } else {
        if (this.match(host, pattern)) {
          return { action: rule.action, rulePattern: pattern };
        }
      }
    }
    return { action: defaultAction, rulePattern: '未匹配任何规则 (兜底)' };
  }

  /**
   * Matches a host against a wildcard pattern
   * Supports:
   * - exact match: 'google.com'
   * - domain wildcard: '*.google.com'
   * - IP wildcard: '192.168.*.*'
   * - match all: '*'
   */
  static match(host, pattern) {
    if (!pattern) return false;
    if (pattern === '*') return true;
    
    // Convert wildcard pattern to regex
    // Escape regex specials except '*'
    const escapedPattern = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    // Replace '*' with '.*'
    const regexStr = '^' + escapedPattern.replace(/\*/g, '.*') + '$';
    const regex = new RegExp(regexStr, 'i');
    
    // For domain wildcards like *.google.com, we also want to match google.com itself
    if (pattern.startsWith('*.')) {
      const baseDomain = pattern.slice(2);
      if (host.toLowerCase() === baseDomain.toLowerCase()) {
        return true;
      }
    }

    return regex.test(host);
  }
}

module.exports = Router;
