<template>
  <div v-if="!isLoggedIn">
    <Login v-model:isDark="isDark" @login-success="onLoginSuccess" />
  </div>
  <div v-else class="min-h-screen" :style="{ background: 'var(--bt-bg)' }">
    <!-- Header -->
    <header class="bt-header px-6 py-0 flex items-center justify-between" style="height: 60px;">
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
      </div>

      <!-- Navigation in center -->
      <div class="flex justify-center flex-1 min-w-[600px]">
        <el-menu :default-active="$route.path" router mode="horizontal" class="bt-nav-header" :ellipsis="false">
          <el-menu-item index="/config">
            <el-icon><Setting /></el-icon> 隧道映射
          </el-menu-item>
          <el-menu-item index="/proxies">
            <el-icon><Connection /></el-icon> 混合代理
          </el-menu-item>
          <el-menu-item index="/nodes">
            <el-icon><Monitor /></el-icon> 代理池
          </el-menu-item>
          <el-menu-item index="/chains">
            <el-icon><Link /></el-icon> 代理链
          </el-menu-item>
          <el-menu-item index="/tester">
            <el-icon><Odometer /></el-icon> 测试台
          </el-menu-item>
          <el-menu-item index="/logs">
            <el-icon><DataLine /></el-icon> 审计
          </el-menu-item>
        </el-menu>
      </div>

      <div class="flex items-center justify-end gap-3 flex-1">
        <!-- Unsaved indicator -->
        <div v-if="hasUnsavedChanges" class="bt-unsaved">
          <el-icon><InfoFilled /></el-icon>
          <span>未保存</span>
        </div>

        <!-- Theme Toggle -->
        <div class="bt-theme-toggle" @click="toggleTheme" :title="isDark ? '切换到亮色模式' : '切换到暗色模式'">
          {{ isDark ? '☀️' : '🌙' }}
        </div>

        <!-- Stop Service -->
        <el-tooltip content="停止服务" placement="bottom">
          <el-button class="bt-btn-danger" size="default" :icon="SwitchButton" circle @click="stopService" />
        </el-tooltip>

        <!-- Restart Service -->
        <el-tooltip content="重启服务" placement="bottom">
          <el-button class="bt-btn-warning" size="default" :icon="RefreshRight" circle @click="restartService" />
        </el-tooltip>

        <!-- Save button -->
        <el-button class="bt-btn-primary" size="default" :icon="Check" @click="saveConfig(false)">
          立即应用配置
        </el-button>
      </div>
    </header>

    <!-- Main content -->
    <main class="mx-auto w-full px-6 py-5" style="max-width: 1440px;">

      <!-- Router View -->
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component
            :is="Component"
            :config="config"
            :status="status"
            :availableIps="availableIps"
            @start="startTunnel"
            @stop="stopTunnel"
            @save="saveConfig(true)"
          />
        </transition>
      </router-view>
    </main>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed, watch, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElNotification, ElMessageBox } from 'element-plus';
import { Connection, Setting, Odometer, InfoFilled, Check, DataLine, Link, Monitor, SwitchButton, RefreshRight } from '@element-plus/icons-vue';
import Login from './components/Login.vue';

const isLoggedIn = ref(false);
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
const hasUnsavedChanges = ref(false);

const toggleTheme = () => {
  isDark.value = !isDark.value;
  document.documentElement.classList.toggle('dark', isDark.value);
  localStorage.setItem('bt-theme', isDark.value ? 'dark' : 'light');
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
    
    // Format arrays for textareas
    if (data.server && data.server.proxies) {
      data.server.proxies.forEach(p => {
        if (p.defaultRuleAction && !Array.isArray(p.defaultRuleAction)) p.defaultRuleAction = [p.defaultRuleAction];
        if (p.proxyRules) p.proxyRules.forEach(r => {
          if (r.action && !Array.isArray(r.action)) r.action = [r.action];
          if (r.pattern && !Array.isArray(r.pattern)) r.pattern = [r.pattern];
          if (!r.id) r.id = Math.random().toString(36).substr(2, 9);
        });
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
          if (!r.id) r.id = Math.random().toString(36).substr(2, 9);
        });
        p._allowIps = (p.allowIps || []).join('\n');
        p._denyIps = (p.denyIps || []).join('\n');
        p._targetAllowIps = (p.targetAllowIps || []).join('\n');
        p._targetDenyIps = (p.targetDenyIps || []).join('\n');
      });
    }
    
    Object.assign(config, data);
    
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
  if (isLoggedIn.value) {
    fetchNetworkInterfaces();
    fetchStatus();
    fetchXrayStatus();
    connectWebSocket();
  }
  
  statusTimer = setInterval(() => {
    if (isLoggedIn.value) {
      fetchStatus();
      fetchXrayStatus();
    }
  }, 2000);
});

const connectWebSocket = () => {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  console.log(`Connecting WebSocket to: ${protocol}//${location.host}`);
  ws = new WebSocket(`${protocol}//${location.host}`);
  ws.onopen = () => {
    console.log("WebSocket connected successfully!");
  };
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      console.log("WebSocket received message:", msg);
      if (msg.type === 'clients_update' && config.server) {
        config.server.knownClients = msg.data;
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
