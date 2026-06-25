<template>
  <el-container class="min-h-screen bg-gray-50">
    <el-header height="80px" class="bg-white flex items-center justify-between px-8">
      <div class="flex items-center gap-4">
        <el-icon :size="28" color="#409EFC"><Connection /></el-icon>
        <h1 class="text-2xl font-bold text-gray-800 m-0">Bi-Tunnel 控制台</h1>
      </div>
      
      <div class="flex items-center gap-4" v-if="currentTab === 'config'">
        <span class="text-sm text-gray-500 mr-2"><el-icon class="mr-1"><InfoFilled /></el-icon>修改配置后请点击保存</span>
        <el-button type="success" size="large" :icon="Check" @click="saveConfig(false)" class="font-bold shadow-md px-8">
          保存配置
        </el-button>
      </div>
    </el-header>

    <el-main class="mx-auto w-full p-6" style="max-width: 1400px;">
      <el-menu :default-active="currentTab" mode="horizontal" class="mb-6 rounded-lg bg-white" @select="handleTabSelect">
        <el-menu-item index="config">
          <el-icon><Setting /></el-icon> 代理与映射配置
        </el-menu-item>
        <el-menu-item index="tester">
          <el-icon><Odometer /></el-icon> 代理测试台
        </el-menu-item>
        <el-menu-item index="logs">
          <el-icon><DataLine /></el-icon> 流量审计
        </el-menu-item>
      </el-menu>

      <transition name="el-fade-in-linear" mode="out-in">
        <ConfigPanel 
          v-if="currentTab === 'config'"
          :config="config"
          :status="status"
          :availableIps="availableIps"
          @start="startTunnel"
          @stop="stopTunnel"
        />
        <ProxyTester 
          v-else-if="currentTab === 'tester'"
        />
        <TrafficLogs
          v-else-if="currentTab === 'logs'"
        />
      </transition>
    </el-main>
  </el-container>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElNotification } from 'element-plus';
import { Connection, Setting, Odometer, InfoFilled, Check, DataLine } from '@element-plus/icons-vue';
import ConfigPanel from './components/ConfigPanel.vue';
import ProxyTester from './components/ProxyTester.vue';
import TrafficLogs from './components/TrafficLogs.vue';

const currentTab = ref('config');

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
      ElMessage.error('启动失败: ' + result.message);
    }
  } catch (e) {
    ElMessage.error('请求失败');
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
    if (result.success && !silent) {
      ElNotification({
        title: '保存成功',
        message: '配置已保存，代理和映射规则已自动热重载。',
        type: 'success',
      });
    }
  } catch (e) {
    if (!silent) ElMessage.error('保存失败！');
  }
};

onMounted(() => {
  fetchNetworkInterfaces();
  fetchConfig();
  fetchStatus();
  setInterval(fetchStatus, 3000);
});
</script>
