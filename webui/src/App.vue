<template>
  <el-container class="min-h-screen bg-gray-50">
    <el-header height="80px" class="bg-white flex items-center justify-between px-8">
      <div class="flex items-center gap-6">
        <div class="flex items-center gap-4">
          <el-icon :size="28" color="#409EFC"><Connection /></el-icon>
          <h1 class="text-2xl font-bold text-gray-800 m-0">Bi-Tunnel 控制台</h1>
        </div>

        <!-- Xray Status Badge -->
        <el-tooltip  :content="xrayStatus.running ? 'Xray 内核正在处理代理流量' : 'Xray 内核处于休眠状态，当产生相关代理连接时按需启动'" placement="bottom">
          <div style="margin-left: 50px" class="flex items-center gap-2 px-3 py-1 rounded-full border transition-colors duration-300 cursor-default"
               :class="xrayStatus.running ? 'bg-green-50 border-green-200 text-green-700' : 'bg-gray-50 border-gray-200 text-gray-500'">
            <span class="relative flex h-2.5 w-2.5">
              <span v-if="xrayStatus.running" class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span class="relative inline-flex rounded-full h-2.5 w-2.5" :class="xrayStatus.running ? 'bg-green-500' : 'bg-gray-400'"></span>
            </span>
            <span class="text-xs font-bold tracking-wide"><el-tag>XRAY CORE</el-tag></span>
            <span v-if="xrayStatus.running" class="text-[10px] ml-1 opacity-80 border-l border-green-200 pl-2">
              <el-tag>PID: {{xrayStatus.pid}} | PORT: {{xrayStatus.port}}</el-tag>
            </span>
          </div>
        </el-tooltip>


      </div>

      <div class="flex items-center gap-4">
        <span class="text-sm text-gray-500 mr-2" v-if="hasUnsavedChanges"><el-icon class="mr-1"><InfoFilled /></el-icon>有未保存的修改</span>
        <el-button type="success" size="large" :icon="Check" @click="saveConfig(false)" class="font-bold shadow-md px-8">
          保存配置
        </el-button>
      </div>
    </el-header>

    <el-main class="mx-auto w-full p-6" style="max-width: 1400px;">
      <el-menu :default-active="$route.path" router mode="horizontal" class="mb-6 rounded-lg bg-white shadow-sm" style="border-bottom: none;">
        <el-menu-item index="/config">
          <el-icon><Setting /></el-icon> 代理与映射配置
        </el-menu-item>
        <el-menu-item index="/nodes">
          <el-icon><Monitor /></el-icon> 代理节点池
        </el-menu-item>
        <el-menu-item index="/chains">
          <el-icon><Link /></el-icon> 代理链管理
        </el-menu-item>
        <el-menu-item index="/tester">
          <el-icon><Odometer /></el-icon> 代理测试台
        </el-menu-item>
        <el-menu-item index="/logs">
          <el-icon><DataLine /></el-icon> 流量审计
        </el-menu-item>
      </el-menu>

      <router-view v-slot="{ Component }">
        <transition name="el-fade-in-linear" mode="out-in">
          <component 
            :is="Component" 
            :config="config" 
            :status="status" 
            :availableIps="availableIps" 
            @start="startTunnel" 
            @stop="stopTunnel" 
          />
        </transition>
      </router-view>
    </el-main>
  </el-container>
</template>

<script setup>
import { ref, reactive, onMounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElNotification, ElMessageBox } from 'element-plus';
import { Connection, Setting, Odometer, InfoFilled, Check, DataLine, Link, Monitor } from '@element-plus/icons-vue';

const hasUnsavedChanges = ref(false);

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
    proxies: []
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
  connectedClients: []
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
    const data = await res.json();
    
    // Format arrays for textareas
    if (data.server && data.server.proxies) {
      data.server.proxies.forEach(p => {
        p._allowIps = (p.allowIps || []).join('\n');
        p._denyIps = (p.denyIps || []).join('\n');
        p._targetAllowIps = (p.targetAllowIps || []).join('\n');
        p._targetDenyIps = (p.targetDenyIps || []).join('\n');
      });
    }
    if (data.client && data.client.proxies) {
      data.client.proxies.forEach(p => {
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
    if (!config.proxyChains) config.proxyChains = [];
    
    // Watch config to show "Unsaved Changes" indicator
    watch(config, () => {
      hasUnsavedChanges.value = true;
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

onMounted(() => {
  fetchNetworkInterfaces();
  fetchConfig();
  fetchStatus();
  fetchXrayStatus();
  setInterval(() => {
    fetchStatus();
    fetchXrayStatus();
  }, 3000);
});
</script>
