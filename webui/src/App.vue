<template>
  <div v-if="isCheckingAuth" class="min-h-screen flex flex-col items-center justify-center gap-3" :style="{ background: 'var(--bt-bg)' }">
    <el-icon class="is-loading" :size="36" color="var(--el-color-primary)"><Loading /></el-icon>
    <span style="font-size: 14px; color: var(--bt-text-sec);">{{ t('common.loading') }}</span>
  </div>
  <div v-else-if="!isLoggedIn">
    <Login v-model:isDark="isDark" @login-success="onLoginSuccess" />
  </div>
  <div v-else class="min-h-screen" :style="{ background: 'var(--bt-bg)' }">
    <!-- Header -->
    <header class="bt-header px-6 py-0 flex items-center justify-between fixed top-0 left-0 right-0 z-50" style="height: 60px;">
      <div class="flex items-center gap-5 flex-1">
        <!-- Logo -->
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--bt-gradient);">
            <el-icon :size="18" color="#fff"><Connection /></el-icon>
          </div>
          <span class="bt-logo">Bi-Tunnel</span>
        </div>

        <!-- Xray Status -->
        <el-tooltip :content="xrayStatus.running ? `Xray 内核运行中 | PID: ${xrayStatus.pid} | PORT: ${xrayStatus.port}` : 'Xray 内核处于休眠状态'" placement="bottom">
          <div class="bt-xray-chip" :class="xrayStatus.running ? 'bt-xray-online' : 'bt-xray-offline'">
            <span class="bt-dot" :class="xrayStatus.running ? 'bt-dot-active' : 'bt-dot-inactive'"></span>
            <span>XRAY</span>
            <span v-if="xrayStatus.running" style="opacity: 0.7;">:{{ xrayStatus.port }}</span>
          </div>
        </el-tooltip>

        <!-- Select Active Proxy -->
        <el-select
          v-model="config.activeProxyId"
          :placeholder="t('header.activeProxy')"
          size="default"
          style="width: 200px; margin-left: 10px;"
          :disabled="allProxies.length === 0"
          @change="handleActiveProxyChange"
        >
          <el-option
            v-for="item in allProxies"
            :key="item.id"
            :label="item.label"
            :value="item.id"
          />
        </el-select>

        <!-- Global System Proxy Switch -->
        <div class="flex flex-col items-start justify-center leading-none" style="margin-left: 5px; height: 38px;">
          <el-switch
            v-model="config.globalProxyEnabled"
            :disabled="!config.activeProxyId"
            inline-prompt
            :active-text="t('header.systemProxy')"
            :inactive-text="t('header.systemProxy')"
            style="width: 80px; height: 20px; --el-switch-on-color: var(--el-color-primary); --el-switch-off-color: var(--el-text-color-placeholder);"
            :loading="systemProxyLoading"
            @change="handleGlobalProxyToggle"
          />
          <span style="font-size: 10px; color: var(--bt-text-sec); margin-top: 3px; transform: scale(0.85); transform-origin: left; white-space: nowrap;">
            {{ t('header.systemProxyDesc') }}
          </span>
        </div>

        <!-- Virtual Network Card (TUN) Switch -->
        <div class="flex flex-col items-start justify-center leading-none" style="height: 38px;">
          <div class="flex items-center gap-1">
            <el-switch
              v-model="config.tunModeEnabled"
              :disabled="!config.activeProxyId"
              inline-prompt
              :active-text="t('header.tunMode')"
              :inactive-text="t('header.tunMode')"
              style="width: 80px; height: 20px; --el-switch-on-color: var(--el-color-primary); --el-switch-off-color: var(--el-text-color-placeholder);"
              :loading="tunLoading"
              @change="handleTunToggle"
            />
            <el-tooltip :content="tunStatus.error || t('header.tunMode')" placement="bottom" :disabled="!tunStatus.error">
              <el-icon v-if="tunStatus.error" color="var(--el-color-error)"><Warning /></el-icon>
            </el-tooltip>
          </div>
          <span style="font-size: 10px; color: var(--bt-text-sec); margin-top: 3px; transform: scale(0.85); transform-origin: left; white-space: nowrap;">
            {{ t('header.tunModeDesc') }}
          </span>
        </div>
      </div>

      <!-- Navigation in center -->
      <div class="flex justify-center flex-1 min-w-[600px]">
        <el-menu :default-active="$route.path" router mode="horizontal" class="bt-nav-header" :ellipsis="false">
          <el-menu-item index="/config">
            <el-icon><Setting /></el-icon> {{ t('nav.tunnel') }}
          </el-menu-item>
          <el-menu-item index="/proxies">
            <el-icon><Connection /></el-icon> {{ t('nav.proxies') }}
          </el-menu-item>
          <el-menu-item index="/nodes">
            <el-icon><Monitor /></el-icon> {{ t('nav.nodes') }}
          </el-menu-item>
          <el-menu-item index="/chains">
            <el-icon><Link /></el-icon> {{ t('nav.chains') }}
          </el-menu-item>
          <el-menu-item index="/rules">
            <el-icon><Memo /></el-icon> {{ t('nav.rules') }}
          </el-menu-item>
          <el-menu-item index="/tester">
            <el-icon><Odometer /></el-icon> {{ t('nav.tester') }}
          </el-menu-item>
          <el-menu-item index="/logs">
            <el-icon><DataLine /></el-icon> {{ t('nav.logs') }}
          </el-menu-item>
        </el-menu>
      </div>

      <div class="flex items-center justify-end gap-3 flex-1">
        <!-- Unsaved indicator -->
        <div v-if="hasUnsavedChanges" class="bt-unsaved">
          <el-icon><InfoFilled /></el-icon>
          <span>{{ t('header.unsavedChanges') }}</span>
        </div>

        <!-- Theme Toggle -->
        <div class="bt-theme-toggle" @click="toggleTheme" :title="isDark ? t('login.themeDarkTitle') : t('login.themeLightTitle')">
          {{ isDark ? '☀️' : '🌙' }}
        </div>

        <!-- Language Switcher -->
        <div class="bt-locale-toggle" @click="toggleLocale" :title="locale === 'zh' ? 'Switch to English' : '切换到中文'">
          {{ locale === 'zh' ? 'EN' : 'ZH' }}
        </div>

        <!-- HTTP/HTTPS Toggle -->
        <el-tooltip :content="isHttps ? '切换到 HTTP 访问' : '切换到 HTTPS 访问'" placement="bottom">
          <el-button class="bt-btn-protocol" size="default" circle @click="toggleProtocol" :loading="switchingProtocol">
            <span style="font-size: 12px; font-weight: bold;">{{ isHttps ? 'HTTPS' : 'HTTP' }}</span>
          </el-button>
        </el-tooltip>

        <!-- Stop Service -->
        <el-tooltip :content="t('header.stopService')" placement="bottom">
          <el-button class="bt-btn-danger" size="default" :icon="SwitchButton" circle @click="stopService" />
        </el-tooltip>

        <!-- Restart Service -->
        <el-tooltip :content="t('header.restartService')" placement="bottom">
          <el-button class="bt-btn-warning" size="default" :icon="RefreshRight" circle @click="restartService" />
        </el-tooltip>

        <!-- Save button -->
        <el-button class="bt-btn-primary" size="default" :icon="Check" :disabled="!hasUnsavedChanges" @click="saveConfig(false)">
          {{ t('header.applyConfig') }}
        </el-button>
      </div>
    </header>
    <!-- Main content -->
    <main class="mx-auto w-full px-6 py-5" :style="{ maxWidth: $route.path === '/logs' ? '80%' : '1440px' }">

      <!-- Router View -->
      <router-view v-slot="slotProps">
        <keep-alive :include="['TrafficLogs']">
        <component
          :is="slotProps.Component"
          :key="slotProps.route.fullPath"
          :config="config"
          :status="status"
          :availableIps="availableIps"
          @start="startTunnel"
          @stop="stopTunnel"
          @save="saveConfig(true)"
        />
        </keep-alive>
      </router-view>
    </main>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed, watch, onUnmounted, provide } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElNotification, ElMessageBox } from 'element-plus';
import { Connection, Setting, Odometer, InfoFilled, Check, DataLine, Link, Monitor, SwitchButton, RefreshRight, Warning, Memo, Loading } from '@element-plus/icons-vue';
import Login from './components/Login.vue';
import { t, locale, setLocale } from './i18n';

const isLoggedIn = ref(false);
const isCheckingAuth = ref(true);

const toggleLocale = () => {
  const newLocale = locale.value === 'zh' ? 'en' : 'zh';
  setLocale(newLocale);
};

provide('t', t);
provide('locale', locale);
let statusTimer = null;

const onLoginSuccess = () => {
  isLoggedIn.value = true;
  fetchConfig();
  fetchNetworkInterfaces();
  fetchStatus();
  fetchXrayStatus();
  connectWebSocket();
};

const isDark = ref(false);
const isHttps = ref(location.protocol === 'https:');
const hasUnsavedChanges = ref(false);

const toggleTheme = () => {
  isDark.value = !isDark.value;
  document.documentElement.classList.toggle('dark', isDark.value);
  localStorage.setItem('bt-theme', isDark.value ? 'dark' : 'light');
};

const switchingProtocol = ref(false);

const toggleProtocol = async () => {
  if (switchingProtocol.value) return;
  const newProtocol = isHttps.value ? 'http' : 'https';
  switchingProtocol.value = true;
  try {
    const res = await fetch('/api/switch-protocol', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ protocol: newProtocol })
    });
    const data = await res.json();
    if (data.success) {
      ElMessage.success(data.message);
      // Wait for server to restart, then redirect to same port with new protocol
      setTimeout(() => {
        window.location.href = `${newProtocol}://${location.hostname}:${location.port}`;
      }, 3000);
    }
  } catch (e) {
    switchingProtocol.value = false;
  }
};

const initTheme = () => {
  const saved = localStorage.getItem('bt-theme');
  if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    isDark.value = true;
    document.documentElement.classList.add('dark');
  }
};

const config = reactive({
  mode: 'server',
  autoStartMode: 'none',
  server: {
    autoStart: false,
    bindHost: '0.0.0.0',
    tunnelPort: 33891,
    password: 'admin',
    forwards: [],
    proxies: []
  },
  client: {
    autoStart: false,
    tunnelHost: '127.0.0.1',
    tunnelPort: 33891,
    password: 'admin',
    forwards: [],
    proxies: [],
    connections: []
  },
  webPort: 8899,
  logConfig: {
    maxDays: 14,
    maxSizeMB: 20
  }
});

const status = reactive({
  serverConnected: false,
  serverRunning: false,
  clientConnected: false,
  clientRunning: false,
  connectedClients: [],
  clientConnections: []
});

const xrayStatus = reactive({
  running: false,
  pid: null,
  port: 0
});

const allProxies = computed(() => {
  const list = [];
  if (config.server && Array.isArray(config.server.proxies)) {
    config.server.proxies.forEach(p => {
      list.push({
        id: p.id,
        port: p.listenPort,
        label: `${p.name || '未命名'} (端口: ${p.listenPort})`,
        type: 'server'
      });
    });
  }
  if (config.client && Array.isArray(config.client.proxies)) {
    config.client.proxies.forEach(p => {
      list.push({
        id: p.id,
        port: p.listenPort,
        label: `${p.name || '未命名'} (端口: ${p.listenPort})`,
        type: 'client'
      });
    });
  }
  return list;
});

// 根据代理 ID 查找其监听端口
const getPortByProxyId = (id) => {
  if (!id) return '';
  const found = allProxies.value.find(p => p.id === id);
  return found ? found.port : '';
};

const tunStatus = computed(() => status.tun || { running: false, pid: null, port: 0, error: null });

const systemProxyLoading = ref(false);
const tunLoading = ref(false);

const handleActiveProxyChange = (val) => {
  // 同步 activeProxyPort（部分后端 API 仍依赖端口）
  config.activeProxyPort = getPortByProxyId(val);
  if (config.globalProxyEnabled) {
    handleGlobalProxyToggle(true);
  }
  if (config.tunModeEnabled) {
    handleTunToggle(true);
  }
  saveConfig(true);
};

const ensureActiveProxyEnabled = () => {
  if (!config.activeProxyId) return;
  let found = false;
  const ensure = (arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach(p => {
      if (p.id === config.activeProxyId && !p.enabled) {
        p.enabled = true;
        found = true;
      }
    });
  };
  ensure(config.server && config.server.proxies);
  ensure(config.client && config.client.proxies);
  if (found) {
    saveConfig(true);
  }
};

const handleGlobalProxyToggle = async (val) => {
  if (!config.activeProxyPort) return;
  systemProxyLoading.value = true;
  try {
    if (val) {
      if (config.tunModeEnabled) {
        config.tunModeEnabled = false;
        config.tunProxyPort = null;
        try {
          await fetch('/api/tun/disable', { method: 'POST' });
          ElMessage.warning('虚拟网卡 (TUN) 模式已自动关闭');
        } catch (e) {
          console.error('Failed to auto-disable TUN:', e);
        }
      }
      ensureActiveProxyEnabled();
      const res = await fetch('/api/system-proxy/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: '127.0.0.1', port: config.activeProxyPort })
      });
      const data = await res.json();
      if (data.success) {
        config.globalProxyPort = config.activeProxyPort;
        ElMessage.success('全局系统代理已开启');
      } else {
        ElMessage.error('开启系统代理失败');
        config.globalProxyEnabled = false;
      }
    } else {
      const res = await fetch('/api/system-proxy/disable', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        config.globalProxyPort = null;
        ElMessage.warning('全局系统代理已关闭');
      } else {
        ElMessage.error('关闭系统代理失败');
        config.globalProxyEnabled = true;
      }
    }
  } catch (e) {
    ElMessage.error('网络请求失败: ' + e.message);
    config.globalProxyEnabled = !val;
  } finally {
    systemProxyLoading.value = false;
  }
};

const handleTunToggle = async (val) => {
  if (!config.activeProxyPort) return;
  tunLoading.value = true;
  try {
    if (val) {
      if (config.globalProxyEnabled) {
        config.globalProxyEnabled = false;
        config.globalProxyPort = null;
        try {
          await fetch('/api/system-proxy/disable', { method: 'POST' });
          ElMessage.warning('全局系统代理已自动关闭');
        } catch (e) {
          console.error('Failed to auto-disable System Proxy:', e);
        }
      }
      ensureActiveProxyEnabled();
      const res = await fetch('/api/tun/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: config.activeProxyPort })
      });
      const data = await res.json();
      if (data.success) {
        config.tunProxyPort = config.activeProxyPort;
        ElMessage.success('虚拟网卡 (TUN) 模式已开启');
      } else {
        ElMessageBox.alert(data.message || '开启失败，未知错误', '虚拟网卡启动失败', {
          confirmButtonText: '确定',
          type: 'error'
        });
        config.tunModeEnabled = false;
      }
    } else {
      const res = await fetch('/api/tun/disable', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        config.tunProxyPort = null;
        ElMessage.warning('虚拟网卡 (TUN) 模式已关闭');
      } else {
        ElMessage.error('关闭虚拟网卡模式失败');
        config.tunModeEnabled = true;
      }
    }
  } catch (e) {
    ElMessage.error('网络请求失败: ' + e.message);
    config.tunModeEnabled = !val;
  } finally {
    tunLoading.value = false;
    fetchStatus();
  }
};

const availableIps = ref(['0.0.0.0', '127.0.0.1']);

const handleTabSelect = (index) => {
  currentTab.value = index;
};

const fetchStatus = async () => {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    status.serverConnected = data.serverConnected;
    status.serverRunning = data.serverRunning;
    status.clientConnected = data.clientConnected;
    status.clientRunning = data.clientRunning;
    status.connectedClients = data.connectedClients || [];
    status.clientConnections = data.clientConnections || [];
    status.tun = data.tun || { running: false, pid: null, port: 0, error: null };
  } catch (e) {}
};

const fetchXrayStatus = async () => {
  try {
    const res = await fetch('/api/xray-status');
    const data = await res.json();
    xrayStatus.running = data.running;
    xrayStatus.pid = data.pid;
    xrayStatus.port = data.port;
  } catch (e) {}
};

const fetchNetworkInterfaces = async () => {
  try {
    const res = await fetch('/api/network-interfaces');
    const data = await res.json();
    if (data && Array.isArray(data)) {
      availableIps.value = data;
    }
  } catch (e) {
    console.error('Failed to fetch network interfaces:', e);
  }
};

const fetchConfig = async () => {
  try {
    const res = await fetch('/api/config');
    if (res.status === 401) {
      isLoggedIn.value = false;
      return;
    }
    const data = await res.json();
    isLoggedIn.value = true;
    connectWebSocket();
    fetchNetworkInterfaces();
    fetchStatus();
    fetchXrayStatus();
    
    // Format arrays for textareas
    if (data.server && data.server.proxies) {
      data.server.proxies.forEach(p => {
        if (p.defaultRuleAction && !Array.isArray(p.defaultRuleAction)) p.defaultRuleAction = [p.defaultRuleAction];
        if (p.proxyRules) p.proxyRules.forEach(r => {
          if (r.action && !Array.isArray(r.action)) r.action = [r.action];
          if (r.pattern && !Array.isArray(r.pattern)) r.pattern = [r.pattern];
          if (!r.ruleCardIds) {
            r.ruleCardIds = r.ruleCardId ? [r.ruleCardId] : [];
          }
          if (!r.id) r.id = Math.random().toString(36).substr(2, 9);
        });
        // 为旧数据补全唯一代理 ID
        if (!p.id) p.id = `proxy_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 6)}`;
        p._allowIps = (p.allowIps || []).join('\n');
        p._denyIps = (p.denyIps || []).join('\n');
        p._targetAllowIps = (p.targetAllowIps || []).join('\n');
        p._targetDenyIps = (p.targetDenyIps || []).join('\n');
      });
    }
    if (data.client && data.client.proxies) {
      data.client.proxies.forEach(p => {
        if (p.defaultRuleAction && !Array.isArray(p.defaultRuleAction)) p.defaultRuleAction = [p.defaultRuleAction];
        if (p.proxyRules) p.proxyRules.forEach(r => {
          if (r.action && !Array.isArray(r.action)) r.action = [r.action];
          if (r.pattern && !Array.isArray(r.pattern)) r.pattern = [r.pattern];
          if (!r.ruleCardIds) {
            r.ruleCardIds = r.ruleCardId ? [r.ruleCardId] : [];
          }
          if (!r.id) r.id = Math.random().toString(36).substr(2, 9);
        });
        // 为旧数据补全唯一代理 ID
        if (!p.id) p.id = `proxy_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 6)}`;
        p._allowIps = (p.allowIps || []).join('\n');
        p._denyIps = (p.denyIps || []).join('\n');
        p._targetAllowIps = (p.targetAllowIps || []).join('\n');
        p._targetDenyIps = (p.targetDenyIps || []).join('\n');
      });
    }

    Object.assign(config, data);

    // 迁移：以 activeProxyId 为唯一标识，兼容旧的 activeProxyPort
    if (!config.activeProxyId) {
      if (config.activeProxyPort) {
        const matched = allProxies.value.find(p => p.port === config.activeProxyPort);
        config.activeProxyId = matched ? matched.id : (allProxies.value[0]?.id || '');
      } else if (allProxies.value.length > 0) {
        config.activeProxyId = allProxies.value[0].id;
      } else {
        config.activeProxyId = '';
      }
    }
    // 保持 activeProxyPort 与 activeProxyId 同步（后端部分 API 仍依赖端口）
    config.activeProxyPort = getPortByProxyId(config.activeProxyId);
    
    if (!config.server) config.server = {};
    if (!config.client) config.client = {};
    if (config.server.autoStart === undefined) config.server.autoStart = false;
    if (config.client.autoStart === undefined) config.client.autoStart = false;
    if (!config.server.forwards) config.server.forwards = [];
    if (!config.server.proxies) config.server.proxies = [];
    if (!config.client.forwards) config.client.forwards = [];
    if (!config.client.proxies) config.client.proxies = [];
    if (!config.client.connections) config.client.connections = [];
    if (!config.proxyChains) config.proxyChains = [];
    if (!config.proxyGroups) config.proxyGroups = [];
    
    // Watch config to show "Unsaved Changes" indicator and auto-save
    let autoSaveTimer = null;
    watch(config, () => {
      hasUnsavedChanges.value = true;
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        saveConfig(true);
      }, 1000);
    }, { deep: true });
    
    setTimeout(() => { hasUnsavedChanges.value = false; }, 100);
  } catch (e) {
    console.error(e);
  } finally {
    isCheckingAuth.value = false;
  }
};

const startTunnel = async (targetMode) => {
  try {
    await saveConfig(true); 
    
    const res = await fetch(`/api/tunnel/${targetMode}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const result = await res.json();
    if (result.success) {
      ElMessage.success(`${targetMode === 'server' ? '服务端' : '客户端'} 隧道已启动`);
      fetchStatus();
    } else {
      if (result.code === 'PORT_IN_USE') {
        try {
          await ElMessageBox.confirm(`端口 ${result.port} 正被其他程序占用，隧道启动失败！\n是否要强制结束占用该端口的后台进程？`, '端口冲突', {
            confirmButtonText: '强制杀掉并重试',
            cancelButtonText: '取消',
            type: 'warning'
          });
          const killRes = await fetch(`/api/kill-port/${result.port}`, { method: 'POST' });
          const killData = await killRes.json();
          if (killData.success) {
            ElMessage.success(killData.message);
            setTimeout(() => startTunnel(targetMode), 1000);
          } else {
            ElMessage.error(killData.message);
          }
        } catch (e) {
          // user cancelled
        }
      } else {
        ElMessage.error('启动失败: ' + result.message);
      }
    }
  } catch (e) {
    ElMessage.error('请求失败: ' + e.message);
  }
};

const stopTunnel = async (targetMode) => {
  try {
    const res = await fetch(`/api/tunnel/${targetMode}/stop`, { method: 'POST' });
    const result = await res.json();
    if (result.success) {
      ElMessage.warning(`${targetMode === 'server' ? '服务端' : '客户端'} 隧道已停止`);
      fetchStatus();
    }
  } catch (e) {}
};

const saveConfig = async (silent = false) => {
  const payload = JSON.parse(JSON.stringify(config));
  
  const processProxies = (proxies) => {
    if (!proxies) return;
    proxies.forEach(p => {
      p.allowIps = p._allowIps ? p._allowIps.split('\n').map(s=>s.trim()).filter(Boolean) : [];
      p.denyIps = p._denyIps ? p._denyIps.split('\n').map(s=>s.trim()).filter(Boolean) : [];
      p.targetAllowIps = p._targetAllowIps ? p._targetAllowIps.split('\n').map(s=>s.trim()).filter(Boolean) : [];
      p.targetDenyIps = p._targetDenyIps ? p._targetDenyIps.split('\n').map(s=>s.trim()).filter(Boolean) : [];
      delete p._allowIps;
      delete p._denyIps;
      delete p._targetAllowIps;
      delete p._targetDenyIps;
    });
  };

  processProxies(payload.server.proxies);
  processProxies(payload.client.proxies);

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (result.success) {
      hasUnsavedChanges.value = false;
      if (!silent) {
        ElNotification({
          title: '保存成功',
          message: '配置已保存，代理和映射规则已自动热重载。',
          type: 'success',
        });
      }
    }
  } catch (e) {
    if (!silent) ElMessage.error('保存失败！');
  }
};


let ws = null;

onMounted(() => {
  initTheme();
  fetchConfig();
  
  statusTimer = setInterval(() => {
    if (isLoggedIn.value) {
      fetchStatus();
      fetchXrayStatus();
    }
  }, 2000);
});

const connectWebSocket = () => {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  console.log(`Connecting WebSocket to: ${protocol}//${location.host}`);
  ws = new WebSocket(`${protocol}//${location.host}`);
  ws.onopen = () => {
    console.log("WebSocket connected successfully!");
  };
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'clients_update' && config.server) {
        config.server.knownClients = msg.data;
      } else if (msg.type === 'connections_update' && config.client) {
        config.client.connections = msg.data;
      } else if (msg.type === 'traffic_log') {
        // Dispatch to registered traffic log listeners
        if (trafficLogListeners.length > 0) {
          trafficLogListeners.forEach(fn => fn(msg.data));
        }
      } else if (msg.type === 'forward_error') {
        // Dispatch to registered forward error listeners
        if (forwardErrorListeners.length > 0) {
          forwardErrorListeners.forEach(fn => fn(msg.data));
        }
      }
    } catch (e) {
      console.error("WS message parse error:", e);
    }
  };
  ws.onerror = (err) => {
    console.error("WebSocket error:", err);
  };
  ws.onclose = () => {
    console.log("WebSocket closed, retrying in 5 seconds...");
    setTimeout(() => {
      if (isLoggedIn.value) connectWebSocket();
    }, 5000);
  };
};

const sendWsMessage = (msg) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  } else {
    console.warn('WebSocket not connected, cannot send message');
  }
};

provide('sendWsMessage', sendWsMessage);

// Traffic log listener registry (for WS-pushed logs)
const trafficLogListeners = [];
provide('onTrafficLog', (fn) => {
  trafficLogListeners.push(fn);
  return () => {
    const idx = trafficLogListeners.indexOf(fn);
    if (idx !== -1) trafficLogListeners.splice(idx, 1);
  };
});

// Forward error listener registry (for WS-pushed port-in-use errors)
const forwardErrorListeners = [];
provide('onForwardError', (fn) => {
  forwardErrorListeners.push(fn);
  return () => {
    const idx = forwardErrorListeners.indexOf(fn);
    if (idx !== -1) forwardErrorListeners.splice(idx, 1);
  };
});

const stopService = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要停止整个 Bi-Tunnel 服务吗？停止后所有隧道和代理将立即断开。',
      '停止服务确认',
      {
        confirmButtonText: '确定停止',
        cancelButtonText: '取消',
        type: 'error',
        confirmButtonClass: 'el-button--danger'
      }
    );
    await fetch('/api/service/stop', { method: 'POST' });
    ElMessage.success('服务正在停止...');
    // 页面将在服务停止后断开
    setTimeout(() => {
      ElMessage.warning('服务已停止，请手动关闭页面');
    }, 1000);
  } catch (e) {
    // 用户取消
  }
};

const restartService = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要重启 Bi-Tunnel 服务吗？重启过程中所有连接将暂时中断。',
      '重启服务确认',
      {
        confirmButtonText: '确定重启',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--warning'
      }
    );
    await fetch('/api/service/restart', { method: 'POST' });
    ElMessage.success('服务正在重启，即将自动刷新页面...');
    // 等待服务重启后刷新页面
    let retries = 0;
    const checkAndReload = async () => {
      try {
        const res = await fetch('/api/status');
        if (res.ok) {
          window.location.reload();
          return;
        }
      } catch (e) {}
      retries++;
      if (retries < 30) {
        setTimeout(checkAndReload, 1000);
      } else {
        ElMessage.error('服务重启超时，请手动刷新页面');
      }
    };
    setTimeout(checkAndReload, 2000);
  } catch (e) {
    // 用户取消
  }
};

onUnmounted(() => {
  if (statusTimer) clearInterval(statusTimer);
  if (ws) ws.close();
});
</script>
