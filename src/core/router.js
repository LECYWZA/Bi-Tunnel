class Router {
  /**
   * Evaluates routing rules to determine the action for a given host
   * @param {string} host Target hostname or IP
   * @param {Array} rules Array of rules: { pattern: string, action: 'direct'|'proxy'|'block' }
   * @param {string} defaultAction Action if no rules match
   * @returns {string} action
   */
  static evaluate(host, rules, defaultAction = 'proxy') {
    if (!rules || !Array.isArray(rules)) return defaultAction;

    for (const rule of rules) {
      if (this.match(host, rule.pattern)) {
        return rule.action;
      }
    }
    return defaultAction;
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
