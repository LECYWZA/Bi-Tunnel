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
    <header class="bt-header px-6 py-0 flex items-center justify-between flex-wrap gap-y-2 sticky top-0 z-50">
      <div class="flex items-center gap-5 flex-1 min-w-0">
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
          class="bt-active-proxy-select"
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
          <div class="flex items-center" style="gap: 6px; height: 20px;">
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
            <el-tooltip content="虚拟网卡参数配置" placement="bottom">
              <el-button class="bt-tun-cfg-btn" circle plain size="default" :icon="Operation" @click="tunConfigDialogVisible = true" />
            </el-tooltip>
            <template v-if="tunStatus.error">
              <el-tooltip :content="tunStatus.error" placement="bottom">
                <el-icon color="var(--el-color-error)" style="font-size: 16px;"><Warning /></el-icon>
              </el-tooltip>
            </template>
          </div>
          <span style="font-size: 10px; color: var(--bt-text-sec); margin-top: 3px; transform: scale(0.85); transform-origin: left; white-space: nowrap;">
            {{ t('header.tunModeDesc') }}
          </span>
        </div>
      </div>

      <!-- Navigation in center -->
      <div class="flex justify-center flex-1 min-w-0">
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
          <el-menu-item index="/router">
            <el-icon><Share /></el-icon> {{ t('nav.router') }}
          </el-menu-item>
          <el-menu-item index="/tester">
            <el-icon><Odometer /></el-icon> {{ t('nav.tester') }}
          </el-menu-item>
          <el-menu-item index="/logs">
            <el-icon><DataLine /></el-icon> {{ t('nav.logs') }}
          </el-menu-item>
        </el-menu>
      </div>

      <div class="flex items-center justify-end gap-3 flex-1 min-w-0">
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

        <!-- Settings Dropdown: 收纳 DNS / HTTPS / 重启 / 停止 等低频操作 -->
        <el-dropdown trigger="click" @command="(cmd) => handleSettingCmd(cmd)" placement="bottom-end">
          <el-button class="bt-btn-default" size="default" :icon="Operation" circle />
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="dns" :icon="Connection">DNS {{ locale === 'zh' ? '配置' : 'Config' }}</el-dropdown-item>
              <el-dropdown-item command="protocol" :icon="Link">
                {{ isHttps ? 'HTTP' : 'HTTPS' }}
              </el-dropdown-item>
              <el-dropdown-item command="restart" :icon="RefreshRight">{{ t('header.restartService') }}</el-dropdown-item>
              <el-dropdown-item command="stop" :icon="SwitchButton" divided>{{ t('header.stopService') }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <!-- Save button -->
        <el-button class="bt-btn-primary" size="default" :icon="Check" :disabled="!hasUnsavedChanges" @click="saveConfig(false)">
          {{ t('header.applyConfig') }}
        </el-button>
      </div>
    </header>

    <!-- DNS 配置弹窗 -->
    <el-dialog
      v-model="dnsDialogVisible"
      title="DNS 配置"
      width="640px"
      :close-on-click-modal="false"
      append-to-body
    >
      <div class="dns-dialog-body">
        <!-- 顶部：从常用 DNS 下拉添加 -->
        <div class="dns-add-row">
          <el-select
            v-model="dnsPresetSelected"
            placeholder="选择常用 DNS 添加"
            filterable
            style="flex: 1; margin-right: 8px;"
            @change="addPresetDns"
          >
            <el-option
              v-for="item in dnsPresets"
              :key="item.address"
              :label="`${item.name} (${item.address})`"
              :value="item.address"
            />
          </el-select>
          <el-input
            v-model="dnsManualInput"
            placeholder="或手动输入，如 1.1.1.1 / tcp://8.8.8.8:53 / https://dns.alidns.com/dns-query"
            style="flex: 2;"
            @keyup.enter="addManualDns"
          />
          <el-button type="primary" :icon="Plus" @click="addManualDns" style="margin-left: 8px;">添加</el-button>
        </div>

        <!-- 包含系统 DNS 开关 -->
        <div class="dns-switch-row">
          <el-switch v-model="config.dnsConfig.includeSystemDns" />
          <span class="dns-switch-label">包含系统 DNS（关闭后仅使用上方自定义列表，打开则系统 DNS 作为兜底追加在末尾）</span>
        </div>

        <!-- DNS 列表（可拖拽排序） -->
        <div class="dns-list-wrap">
          <div v-if="config.dnsConfig.servers.length === 0" class="dns-empty">
            暂无自定义 DNS，点击上方添加。{{ config.dnsConfig.includeSystemDns ? '当前将使用系统 DNS。' : '当前为空，TUN 启动时会使用默认 1.1.1.1/8.8.8.8。' }}
          </div>
          <div
            v-for="(item, idx) in config.dnsConfig.servers"
            :key="item.id"
            class="dns-item"
            draggable="true"
            @dragstart="onDnsDragStart($event, idx)"
            @dragover.prevent="onDnsDragOver($event, idx)"
            @drop="onDnsDrop($event, idx)"
            @dragend="dnsDragIndex = -1"
            :class="{ 'dns-item-dragging': dnsDragIndex === idx }"
          >
            <el-icon class="dns-drag-handle"><Rank /></el-icon>
            <span class="dns-item-index">{{ idx + 1 }}.</span>
            <span class="dns-item-address">{{ item.address }}</span>
            <el-tag size="small" :type="item._valid === true ? 'success' : (item._valid === false ? 'danger' : 'info')" style="margin-left: 8px;">
              {{ item._valid === true ? '有效' : (item._valid === false ? '无效' : '未验证') }}
            </el-tag>
            <span v-if="item._message" class="dns-item-msg" :title="item._message">{{ item._message }}</span>
            <div class="dns-item-actions">
              <el-button size="small" :loading="item._testing" @click="testDns(item)">验证</el-button>
              <el-button size="small" type="danger" :icon="Delete" circle plain @click="removeDns(idx)" />
            </div>
          </div>
        </div>

        <!-- 系统当前 DNS 预览 -->
        <div class="dns-system-row" v-if="systemDnsList.length > 0">
          <span class="dns-system-label">当前系统 DNS：</span>
          <el-tag v-for="s in systemDnsList" :key="s" size="small" style="margin: 2px;">{{ s }}</el-tag>
        </div>
      </div>

      <template #footer>
        <el-button @click="dnsDialogVisible = false">关闭</el-button>
        <el-button type="primary" @click="applyDnsConfig">保存并应用</el-button>
      </template>
    </el-dialog>

    <!-- 虚拟网卡参数配置弹窗 -->
    <el-dialog
      v-model="tunConfigDialogVisible"
      title="虚拟网卡参数配置"
      width="460px"
      :close-on-click-modal="false"
      append-to-body
    >
      <el-alert
        class="bt-tun-alert"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 16px;"
        title="修改后需关闭并重新开启虚拟网卡才能生效"
      />
      <el-form label-width="110px" label-position="right">
        <el-form-item label="网卡名称">
          <el-input v-model="tunConfigTemp.interfaceName" placeholder="tun-bi" />
          <div style="font-size: 11px; color: var(--bt-text-sec); margin-top: 4px;">TUN 虚拟网卡的接口名</div>
        </el-form-item>
        <el-form-item label="网关地址">
          <el-input v-model="tunConfigTemp.gateway" placeholder="10.0.9.1/24" />
          <div style="font-size: 11px; color: var(--bt-text-sec); margin-top: 4px;">CIDR 格式：IP/掩码，例如 10.0.9.1/24</div>
        </el-form-item>
        <el-form-item label="MTU">
          <el-input-number v-model="tunConfigTemp.mtu" :min="576" :max="9000" :step="100" controls-position="right" style="width: 100%;" />
          <div style="font-size: 11px; color: var(--bt-text-sec); margin-top: 4px;">最大传输单元，默认 1500，网络不稳定时可调小</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="tunConfigDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="applyTunConfig">保存</el-button>
      </template>
    </el-dialog>

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
import { Connection, Setting, Odometer, InfoFilled, Check, DataLine, Link, Monitor, SwitchButton, RefreshRight, Warning, Memo, Loading, Plus, Delete, Rank, Operation, Share } from '@element-plus/icons-vue';
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
  },
  dnsConfig: {
    includeSystemDns: true,
    servers: []
  },
  tunConfig: {
    interfaceName: 'tun-bi',
    gateway: '10.0.9.1/24',
    mtu: 1500
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

// ============ DNS 配置弹窗 ============
const dnsDialogVisible = ref(false);
const dnsManualInput = ref('');
const dnsPresetSelected = ref('');
const dnsDragIndex = ref(-1);
const systemDnsList = ref([]);

// ============ 虚拟网卡参数配置弹窗 ============
const tunConfigDialogVisible = ref(false);
const tunConfigTemp = reactive({
  interfaceName: 'tun-bi',
  gateway: '10.0.9.1/24',
  mtu: 1500
});

watch(tunConfigDialogVisible, (v) => {
  if (v) {
    // 打开时从 config 同步当前值
    tunConfigTemp.interfaceName = config.tunConfig?.interfaceName || 'tun-bi';
    tunConfigTemp.gateway = config.tunConfig?.gateway || '10.0.9.1/24';
    tunConfigTemp.mtu = config.tunConfig?.mtu || 1500;
  }
});

const applyTunConfig = () => {
  // 简单校验
  const name = (tunConfigTemp.interfaceName || '').trim();
  const gw = (tunConfigTemp.gateway || '').trim();
  const mtu = parseInt(tunConfigTemp.mtu);
  if (!name) { ElMessage.error('网卡名称不能为空'); return; }
  if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(gw)) { ElMessage.error('网关地址格式错误，应为 IP/掩码，例如 10.0.9.1/24'); return; }
  if (!(mtu >= 576 && mtu <= 9000)) { ElMessage.error('MTU 应在 576-9000 之间'); return; }
  if (!config.tunConfig) config.tunConfig = {};
  config.tunConfig.interfaceName = name;
  config.tunConfig.gateway = gw;
  config.tunConfig.mtu = mtu;
  tunConfigDialogVisible.value = false;
  ElMessage.success('虚拟网卡参数已保存，关闭并重新开启虚拟网卡后生效');
};

// 常用 DNS 预设（含多种协议形态，覆盖国内外主流）
const dnsPresets = [
  { name: 'Cloudflare DNS (UDP)', address: '1.1.1.1' },
  { name: 'Cloudflare DNS (TCP)', address: 'tcp://1.1.1.1:53' },
  { name: 'Cloudflare DoH', address: 'https://1.1.1.1/dns-query' },
  { name: 'Google DNS (UDP)', address: '8.8.8.8' },
  { name: 'Google DNS (TCP)', address: 'tcp://8.8.8.8:53' },
  { name: 'Google DoH', address: 'https://dns.google/dns-query' },
  { name: '阿里公共 DNS (UDP)', address: '223.5.5.5' },
  { name: '阿里公共 DNS (TCP)', address: 'tcp://223.5.5.5:53' },
  { name: '阿里 DoH', address: 'https://dns.alidns.com/dns-query' },
  { name: '腾讯 DNSPod (UDP)', address: '119.29.29.29' },
  { name: '腾讯 DNSPod DoH', address: 'https://doh.pub/dns-query' },
  { name: '114 DNS (UDP)', address: '114.114.114.114' },
  { name: '百度 DNS (UDP)', address: '180.76.76.76' },
  { name: 'Quad9 DNS (UDP)', address: '9.9.9.9' },
  { name: 'OpenDNS (UDP)', address: '208.67.222.222' },
  { name: 'AdGuard DNS (UDP, 去广告)', address: '94.140.14.14' }
];

const genDnsId = () => `dns_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 6)}`;

// 加载系统 DNS 列表（打开弹窗时拉取）
const loadSystemDns = async () => {
  try {
    const res = await fetch('/api/system-dns');
    const data = await res.json();
    if (data.success) systemDnsList.value = data.servers || [];
  } catch (e) {
    console.error('Load system DNS failed:', e);
  }
};

watch(dnsDialogVisible, (v) => {
  if (v) loadSystemDns();
});

const addDnsServer = (address) => {
  const addr = (address || '').trim();
  if (!addr) return false;
  // 去重
  if (config.dnsConfig.servers.some(s => s.address === addr)) {
    ElMessage.warning('该 DNS 已存在');
    return false;
  }
  config.dnsConfig.servers.push({
    id: genDnsId(),
    address: addr,
    _valid: null,
    _message: '',
    _testing: false
  });
  return true;
};

const addPresetDns = (val) => {
  if (addDnsServer(val)) {
    ElMessage.success('已添加');
  }
  dnsPresetSelected.value = '';
};

const addManualDns = () => {
  const val = dnsManualInput.value.trim();
  if (!val) return;
  if (addDnsServer(val)) {
    dnsManualInput.value = '';
    ElMessage.success('已添加');
  }
};

const removeDns = (idx) => {
  config.dnsConfig.servers.splice(idx, 1);
};

// 拖拽排序
const onDnsDragStart = (e, idx) => {
  dnsDragIndex.value = idx;
  e.dataTransfer.effectAllowed = 'move';
};
const onDnsDragOver = (e, idx) => {
  e.dataTransfer.dropEffect = 'move';
};
const onDnsDrop = (e, idx) => {
  const from = dnsDragIndex.value;
  if (from === -1 || from === idx) return;
  const list = config.dnsConfig.servers;
  const [moved] = list.splice(from, 1);
  list.splice(idx, 0, moved);
  dnsDragIndex.value = -1;
};

// 验证单个 DNS
const testDns = async (item) => {
  Object.assign(item, { _testing: true, _message: '验证中...', _valid: null });
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const res = await fetch('/api/dns-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: item.address }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    Object.assign(item, {
      _valid: !!data.valid,
      _message: data.message || (data.valid ? '可用' : '不可用'),
      _testing: false
    });
  } catch (e) {
    const msg = e.name === 'AbortError' ? '验证超时（8s）' : ('请求失败: ' + e.message);
    Object.assign(item, { _valid: false, _message: msg, _testing: false });
  }
};

// 保存并应用 DNS 配置
const applyDnsConfig = async () => {
  // 保存前清理临时字段
  const cleanServers = config.dnsConfig.servers.map(({ id, address }) => ({ id, address }));
  config.dnsConfig.servers = cleanServers;
  await saveConfig(true);
  dnsDialogVisible.value = false;
  ElMessage.success('DNS 配置已保存，下次启动 TUN 时生效');
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
        // 默认动作迁移为对象数组 defaultRuleActions;兼容旧 defaultRuleAction 字符串数组
        if (!p.defaultRuleActions) {
          const old = Array.isArray(p.defaultRuleAction) ? p.defaultRuleAction : (p.defaultRuleAction ? [p.defaultRuleAction] : ['direct_local']);
          p.defaultRuleActions = old.map(act => ({ action: act, networkMode: 'local', targetClientId: '' }));
          delete p.defaultRuleAction;
        } else {
          p.defaultRuleActions.forEach(it => {
            if (!it.networkMode) it.networkMode = 'local';
            if (!it.targetClientId) it.targetClientId = '';
          });
        }
        if (p.proxyRules) p.proxyRules.forEach(r => {
          if (r.action && !Array.isArray(r.action)) r.action = [r.action];
          if (r.pattern && !Array.isArray(r.pattern)) r.pattern = [r.pattern];
          if (!r.ruleCardIds) {
            r.ruleCardIds = r.ruleCardId ? [r.ruleCardId] : [];
          }
          if (!r.id) r.id = Math.random().toString(36).substr(2, 9);
          if (!r.networkMode) r.networkMode = 'local';
          if (!r.targetClientId) r.targetClientId = '';
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
        // 默认动作迁移为对象数组 defaultRuleActions;兼容旧 defaultRuleAction 字符串数组
        if (!p.defaultRuleActions) {
          const old = Array.isArray(p.defaultRuleAction) ? p.defaultRuleAction : (p.defaultRuleAction ? [p.defaultRuleAction] : ['direct_local']);
          p.defaultRuleActions = old.map(act => ({ action: act, networkMode: 'local', targetClientId: '' }));
          delete p.defaultRuleAction;
        } else {
          p.defaultRuleActions.forEach(it => {
            if (!it.networkMode) it.networkMode = 'local';
            if (!it.targetClientId) it.targetClientId = '';
          });
        }
        if (p.proxyRules) p.proxyRules.forEach(r => {
          if (r.action && !Array.isArray(r.action)) r.action = [r.action];
          if (r.pattern && !Array.isArray(r.pattern)) r.pattern = [r.pattern];
          if (!r.ruleCardIds) {
            r.ruleCardIds = r.ruleCardId ? [r.ruleCardId] : [];
          }
          if (!r.id) r.id = Math.random().toString(36).substr(2, 9);
          if (!r.networkMode) r.networkMode = 'local';
          if (!r.targetClientId) r.targetClientId = '';
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
    if (!config.dnsConfig) config.dnsConfig = { includeSystemDns: true, servers: [] };
    if (!Array.isArray(config.dnsConfig.servers)) config.dnsConfig.servers = [];
    if (config.dnsConfig.includeSystemDns === undefined) config.dnsConfig.includeSystemDns = true;
    
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

// 顶部设置下拉菜单命令分发
const handleSettingCmd = (cmd) => {
  if (cmd === 'dns') dnsDialogVisible.value = true;
  else if (cmd === 'protocol') toggleProtocol();
  else if (cmd === 'restart') restartService();
  else if (cmd === 'stop') stopService();
};

onUnmounted(() => {
  if (statusTimer) clearInterval(statusTimer);
  if (ws) ws.close();
});
</script>
