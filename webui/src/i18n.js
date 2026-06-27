import { ref } from 'vue';

export const locale = ref(localStorage.getItem('bt-locale') || (navigator.language.startsWith('zh') ? 'zh' : 'en'));

export const setLocale = (lang) => {
  locale.value = lang;
  localStorage.setItem('bt-locale', lang);
};

export const messages = {
  zh: {
    common: {
      confirm: '确定',
      cancel: '取消',
      save: '保存',
      delete: '删除',
      edit: '编辑',
      add: '添加',
      status: '状态',
      action: '操作',
      enabled: '已启用',
      disabled: '已禁用',
      loading: '加载中...',
      success: '操作成功',
      failed: '操作失败',
      warning: '提示'
    },
    header: {
      activeProxy: '选择活动代理',
      systemProxy: '系统代理',
      systemProxyDesc: 'HTTP/SOCKS5 代理',
      tunMode: '虚拟网卡',
      tunModeDesc: '全局 TUN 流量转发',
      applyConfig: '立即应用配置',
      restartService: '重启 Bi-Tunnel 服务',
      stopService: '停止整个 Bi-Tunnel 服务',
      unsavedChanges: '有未保存的更改'
    },
    nav: {
      tunnel: '隧道映射',
      proxies: '混合代理',
      nodes: '代理池',
      chains: '代理链',
      rules: '分流规则',
      router: '路由系统',
      tester: '测试台',
      logs: '审计'
    },
    logs: {
      title: '实时流量审计',
      refreshing: '正在实时刷新',
      paused: '自动刷新已暂停',
      realtime: '实时',
      pause: '暂停',
      manualRefresh: '手动刷新',

      searchTarget: '搜索访问目标 (如 google.com)',
      searchSourceIp: '源 IP',
      searchRulePattern: '匹配规则',
      statusAll: '所有状态',
      policy: '路由策略',
      module: '模块',
      targetChain: '访问目标 / 链路',
      duration: '耗时',
      traffic: '流量',
      status: '状态',
      local: '本机',
      direct: '直连',
      tunnel: '隧道',
      tunnelFwd: '隧道转发',
      tunnelRev: '隧道反向代理',
      block: '拦截',
      success: '成功',
      failed: '失败',
      id: 'ID',
      time: '时间',
      quickAddTitle: '快速添加到分流规则',
      quickAddEmpty: '您的分流规则卡片列表为空，请先前往“分流规则”页面创建一张卡片。',
      quickAddGoto: '去创建分流卡片',
      quickAddTarget: '待添加的目标域名/IP',
      quickAddSelect: '选择规则卡片',
      quickAddPreview: '规则卡片内容预览与编辑',
      quickAddTip: '* 目标已自动追加至最后一行。您可以在上方编辑器中直接编辑保存。',
      quickAddSuccess: '成功将 {target} 添加至规则卡片 [{name}]'
    },
    login: {
      title: 'Bi-Tunnel 管理面板',
      subtitle: '安全的高性能双向穿透控制台',
      usernamePlaceholder: '请输入账号 (默认: admin)',
      passwordPlaceholder: '请输入密码 (默认: password)',
      submit: '进入控制台',
      usernameRequired: '请输入账号',
      passwordRequired: '请输入密码',
      themeDarkTitle: '切换到亮色模式',
      themeLightTitle: '切换到暗色模式',
      success: '登录成功',
      failed: '登录失败',
      netError: '网络错误: '
    }
  },
  en: {
    common: {
      confirm: 'Confirm',
      cancel: 'Cancel',
      save: 'Save',
      delete: 'Delete',
      edit: 'Edit',
      add: 'Add',
      status: 'Status',
      action: 'Action',
      enabled: 'Enabled',
      disabled: 'Disabled',
      loading: 'Loading...',
      success: 'Success',
      failed: 'Failed',
      warning: 'Warning'
    },
    header: {
      activeProxy: 'Select Active Proxy',
      systemProxy: 'Sys Proxy',
      systemProxyDesc: 'HTTP/SOCKS5 Proxy',
      tunMode: 'TUN Mode',
      tunModeDesc: 'Global TUN Routing',
      applyConfig: 'Apply Config',
      restartService: 'Restart Bi-Tunnel Service',
      stopService: 'Stop Bi-Tunnel Service',
      unsavedChanges: 'Unsaved Changes'
    },
    nav: {
      tunnel: 'Mappings',
      proxies: 'Mixed Proxies',
      nodes: 'Proxy Pools',
      chains: 'Proxy Chains',
      rules: 'Split Rules',
      router: 'Router',
      tester: 'Tester',
      logs: 'Audit'
    },
    logs: {
      title: 'Real-time Traffic Audit',
      refreshing: 'Live Refreshing',
      paused: 'Auto Refresh Paused',
      realtime: 'Live',
      pause: 'Pause',
      manualRefresh: 'Manual Refresh',

      searchTarget: 'Search target (e.g. google.com)',
      searchSourceIp: 'Source IP',
      searchRulePattern: 'Rule/Pattern',
      statusAll: 'All Statuses',
      policy: 'Routing Policy',
      module: 'Module',
      targetChain: 'Target / Route Chain',
      duration: 'Duration',
      traffic: 'Traffic',
      status: 'Status',
      local: 'Local',
      direct: 'Direct',
      tunnel: 'Tunnel',
      tunnelFwd: 'Tunnel Fwd',
      tunnelRev: 'Reverse Proxy',
      block: 'Block',
      success: 'Success',
      failed: 'Failed',
      id: 'ID',
      time: 'Time',
      quickAddTitle: 'Quick Add to Split Rule',
      quickAddEmpty: 'Your rule cards are empty, please create a card in the "Split Rules" section first.',
      quickAddGoto: 'Go to Rules',
      quickAddTarget: 'Target domain/IP to add',
      quickAddSelect: 'Select Rule Card',
      quickAddPreview: 'Rule Card Preview & Edit',
      quickAddTip: '* Target automatically appended to the last line. You can edit directly in the text area.',
      quickAddSuccess: 'Successfully added {target} to rule card [{name}]'
    },
    login: {
      title: 'Bi-Tunnel Admin Panel',
      subtitle: 'Secure High-Performance Reverse Proxy Console',
      usernamePlaceholder: 'Enter username (default: admin)',
      passwordPlaceholder: 'Enter password (default: password)',
      submit: 'Login',
      usernameRequired: 'Username is required',
      passwordRequired: 'Password is required',
      themeDarkTitle: 'Switch to light mode',
      themeLightTitle: 'Switch to dark mode',
      success: 'Login successful',
      failed: 'Login failed',
      netError: 'Network error: '
    }
  }
};

export const t = (key) => {
  const keys = key.split('.');
  let obj = messages[locale.value];
  for (const k of keys) {
    if (!obj || obj[k] === undefined) return key;
    obj = obj[k];
  }
  return obj;
};
