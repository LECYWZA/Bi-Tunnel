<template>
  <div class="space-y-6">
    <!-- 顶部状态卡 -->
    <el-card shadow="hover" class="bt-card">
      <div class="flex items-center gap-3 mb-4">
        <el-icon :size="22" style="color: var(--bt-primary)"><Share /></el-icon>
        <div class="flex-1">
          <div class="font-bold text-base bt-text">{{ t('router.title') }}</div>
          <div class="text-xs bt-text-secondary mt-1">
            {{ t('router.subtitle') }}
            <span style="color: var(--el-color-warning); font-weight: 600;">⚠️ {{ t('common.experimental') }}</span>
          </div>
        </div>
        <el-tag :type="running ? 'success' : 'info'" effect="dark" round size="large">
          {{ running ? t('common.running') : t('common.stopped') }}
        </el-tag>
        <el-button v-if="!running" type="primary" :icon="VideoPlay" :loading="starting" @click="startRouter">{{ t('router.startRouter') }}</el-button>
        <el-button v-else type="danger" :icon="VideoPause" :loading="stopping" @click="stopRouter">{{ t('router.stopRouter') }}</el-button>
      </div>

      <el-alert
        v-if="cfg.interface && cfg.interface !== '0.0.0.0' && !running"
        type="warning"
        :closable="false"
        show-icon
        class="mt-2 mb-2"
      >
        <template #title>
          <span style="font-weight: 600;">{{ t('router.interfaceWarnTitle') }}</span>
        </template>
        <div class="text-xs" style="line-height: 1.6;" v-html="t('router.interfaceWarnBody', { iface: cfg.interface })"></div>
      </el-alert>

      <el-form label-position="top" class="mt-2">
        <el-row :gutter="16">
          <el-col :span="6">
            <el-form-item class="mb-2">
              <template #label>{{ t('router.routerName') }}</template>
              <el-input v-model="cfg.name" :placeholder="t('router.routerNamePlaceholder')" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item class="mb-2">
              <template #label>
                <div class="flex items-center gap-1">
                  <span>{{ t('router.interface') }}</span>
                  <el-tooltip :content="t('router.interfaceTooltip')" placement="top">
                    <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                  </el-tooltip>
                </div>
              </template>
              <el-select v-model="cfg.interface" :placeholder="t('router.interface')" filterable style="width: 100%;">
                <el-option
                  :label="t('router.interfaceWildcard')"
                  value="0.0.0.0"
                />
                <el-option
                  v-for="i in interfaces"
                  :key="i.name"
                  :label="`${i.name} (${i.address})`"
                  :value="i.name"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item class="mb-2">
              <template #label>
                <div class="flex items-center gap-1">
                  <span>{{ t('router.subnetCidr') }}</span>
                  <el-tooltip :content="t('router.subnetCidrTooltip')" placement="top">
                    <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                  </el-tooltip>
                </div>
              </template>
              <el-input v-model="cfg.subnetCidr" :placeholder="t('router.subnetCidrPlaceholder')" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item class="mb-2">
              <template #label>{{ t('router.upstreamMode') }}</template>
              <el-select v-model="cfg.upstreamMode" style="width: 100%;">
                <el-option :label="t('router.upstreamDirect')" value="direct" />
                <el-option :label="t('router.upstreamSystemProxy')" value="systemProxy" />
                <el-option :label="t('router.upstreamTun')" value="tun" />
                <el-option :label="t('router.upstreamProxy')" value="proxy" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="24" v-if="cfg.upstreamMode === 'proxy'">
            <el-form-item class="mb-2">
              <template #label>
                <div class="flex items-center gap-1">
                  <span>{{ t('router.upstreamProxy') }}</span>
                  <el-tooltip :content="t('router.upstreamProxy')" placement="top">
                    <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                  </el-tooltip>
                </div>
              </template>
              <el-select v-model="cfg.upstreamProxyId" :placeholder="t('router.selectProxy')" style="width: 100%;">
                <el-option
                  v-for="p in allProxies"
                  :key="p.id"
                  :label="p.label"
                  :value="p.id"
                />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <div class="flex justify-end">
          <el-button type="primary" :icon="Check" @click="saveConfig">{{ t('common.save') }}</el-button>
        </div>
      </el-form>
    </el-card>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- DHCP 配置 -->
      <el-card shadow="hover" class="bt-card">
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <el-icon style="color: var(--bt-primary)"><Connection /></el-icon>
              <span class="font-bold text-base bt-text">{{ t('router.dhcpSettings') }}</span>
            </div>
            <el-switch v-model="cfg.dhcp.enabled" inline-prompt :active-text="t('router.enableDhcp')" :inactive-text="t('router.macFilterDisabled')" />
          </div>
        </template>
        <el-form label-position="top">
          <el-row :gutter="12">
            <el-col :span="12">
              <el-form-item class="mb-3">
                <template #label>{{ t('router.dhcpRangeStart') }}</template>
                <el-input v-model="cfg.dhcp.rangeStart" placeholder="192.168.88.100" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item class="mb-3">
                <template #label>{{ t('router.dhcpRangeEnd') }}</template>
                <el-input v-model="cfg.dhcp.rangeEnd" placeholder="192.168.88.200" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item class="mb-3">
                <template #label>{{ t('router.dhcpLeaseTime') }}</template>
                <el-input-number v-model="cfg.dhcp.leaseTimeHours" :min="1" :max="168" style="width: 100%;" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item class="mb-3">
                <template #label>{{ t('router.dhcpGateway') }}</template>
                <el-input v-model="cfg.dhcp.gateway" placeholder="192.168.88.1" />
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item class="mb-3">
                <template #label>
                  <div class="flex items-center gap-1">
                    <span>{{ t('router.dhcpDns') }}</span>
                    <el-tooltip :content="t('router.dhcpDnsTooltip')" placement="top">
                      <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                    </el-tooltip>
                  </div>
                </template>
                <div class="text-sm bt-text-secondary">
                  {{ t('router.dhcpDns') }}：
                  <span v-if="resolvedDns.length" class="bt-text font-medium">{{ resolvedDns.join(', ') }}</span>
                  <span v-else class="text-gray-400">—</span>
                </div>
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>
      </el-card>

      <!-- MAC 过滤 -->
      <el-card shadow="hover" class="bt-card">
        <template #header>
          <div class="flex items-center gap-2">
            <el-icon style="color: var(--bt-primary)"><Filter /></el-icon>
            <span class="font-bold text-base bt-text">{{ t('router.macFilter') }}</span>
          </div>
        </template>
        <el-form label-position="top">
          <el-form-item class="mb-3">
            <template #label>{{ t('router.macFilterMode') }}</template>
            <el-radio-group v-model="cfg.macFilter.mode">
              <el-radio-button value="disabled">{{ t('router.macFilterDisabled') }}</el-radio-button>
              <el-radio-button value="whitelist">{{ t('router.macFilterWhitelist') }}</el-radio-button>
              <el-radio-button value="blacklist">{{ t('router.macFilterBlacklist') }}</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="cfg.macFilter.mode !== 'disabled'" class="mb-0">
            <template #label>{{ t('router.macFilterAddresses') }}</template>
            <el-input
              :model-value="cfg.macFilter.addresses.join('\n')"
              @update:model-value="v => cfg.macFilter.addresses = v.split('\n').map(s => s.trim().toUpperCase()).filter(Boolean)"
              type="textarea"
              :rows="6"
              :placeholder="t('router.macFilterPlaceholder')"
            />
          </el-form-item>
        </el-form>
      </el-card>
    </div>

    <!-- 静态绑定 -->
    <el-card shadow="hover" class="bt-card">
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <el-icon style="color: var(--bt-primary)"><EditPen /></el-icon>
            <span class="font-bold text-base bt-text">{{ t('router.staticBindings') }}</span>
          </div>
          <el-button type="primary" plain size="small" :icon="Plus" @click="addBinding">{{ t('router.addBinding') }}</el-button>
        </div>
      </template>
      <el-empty v-if="cfg.staticBindings.length === 0" :description="t('common.empty')" :image-size="60" />
      <div v-else class="space-y-2">
        <div v-for="(b, i) in cfg.staticBindings" :key="i" class="flex items-center gap-2">
          <el-select
            v-model="b.mac"
            :placeholder="t('router.bindingDevicePlaceholder')"
            filterable
            allow-create
            default-first-option
            style="flex: 1;"
            @change="(val) => onBindingMacChange(b, val)"
          >
            <el-option
              v-for="d in devices"
              :key="d.mac"
              :label="`${d.mac}${d.hostname ? ' (' + d.hostname + ')' : ''}`"
              :value="d.mac"
            />
          </el-select>
          <el-input v-model="b.ip" :placeholder="t('router.bindingIp')" style="flex: 1;" />
          <el-input v-model="b.name" :placeholder="t('router.deviceHostname')" style="flex: 1;" />
          <el-button type="danger" :icon="Delete" circle plain @click="cfg.staticBindings.splice(i, 1)" />
        </div>
      </div>
    </el-card>

    <!-- 已连接设备 -->
    <el-card shadow="hover" class="bt-card">
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <el-icon style="color: var(--bt-primary)"><Monitor /></el-icon>
            <span class="font-bold text-base bt-text">{{ t('router.devices') }}</span>
            <el-tag size="small" type="info">{{ devices.length }}</el-tag>
          </div>
          <el-button :icon="Refresh" circle plain size="small" @click="fetchDevices" :loading="loadingDevices" />
        </div>
      </template>
      <el-table :data="devices" v-loading="loadingDevices" stripe size="default">
        <el-table-column :label="t('router.deviceMac')" prop="mac" width="180" />
        <el-table-column :label="t('router.deviceIp')" prop="ip" width="140" />
        <el-table-column :label="t('router.deviceHostname')" prop="hostname" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.hostname">{{ row.hostname }}</span>
            <span v-else class="text-gray-400">—</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('common.status')" prop="source" width="90">
          <template #default="{ row }">
            <span :class="sourceClass(row.source)">{{ sourceLabel(row.source) }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('router.deviceStatus')" width="100">
          <template #default="{ row }">
            <span :class="statusClass(row)">
              {{ statusLabel(row) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column :label="t('logs.time')" width="170">
          <template #default="{ row }">
            {{ row.lastSeen ? formatTime(row.lastSeen) : '—' }}
          </template>
        </el-table-column>
        <el-table-column :label="t('router.deviceActions')" width="220">
          <template #default="{ row }">
            <el-button
              size="small"
              :type="row.enabled === false ? 'success' : 'warning'"
              plain
              @click="toggleDevice(row)"
            >
              {{ row.enabled === false ? t('common.enabled') : t('common.disabled') }}
            </el-button>
            <el-button size="small" type="danger" plain @click="kickDevice(row)">{{ t('router.kickDevice') }}</el-button>
            <el-button size="small" type="danger" circle plain :icon="Delete" @click="deleteDevice(row)" />
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Share, Connection, Filter, EditPen, Plus, Delete, Monitor, Refresh,
  VideoPlay, VideoPause, Check, InfoFilled
} from '@element-plus/icons-vue';
import { t } from '../i18n';

const props = defineProps({ config: Object });

const cfg = reactive({
  name: 'bi-router',
  interface: '',
  subnetCidr: '192.168.88.1/24',
  upstreamMode: 'direct',
  upstreamProxyId: '',
  dhcp: {
    enabled: true,
    rangeStart: '192.168.88.100',
    rangeEnd: '192.168.88.200',
    leaseTimeHours: 24,
    gateway: '192.168.88.1'
  },
  macFilter: { mode: 'disabled', addresses: [] },
  staticBindings: [],
  devices: []
});

const running = ref(false);
const starting = ref(false);
const stopping = ref(false);
const interfaces = ref([]);
const devices = ref([]);
const loadingDevices = ref(false);

const allProxies = computed(() => {
  const list = [];
  const c = props.config || {};
  if (c.server && Array.isArray(c.server.proxies)) {
    c.server.proxies.forEach(p => list.push({
      id: p.id,
      label: `${p.name || t('common.unnamed')} (${t('forward.localPort')}: ${p.listenPort})`
    }));
  }
  if (c.client && Array.isArray(c.client.proxies)) {
    c.client.proxies.forEach(p => list.push({
      id: p.id,
      label: `${p.name || t('common.unnamed')} (${t('forward.localPort')}: ${p.listenPort})`
    }));
  }
  return list;
});

// 从全局 dnsConfig 读取，仅展示纯 IPv4 格式（与后端 _resolveDnsList 逻辑一致）
const resolvedDns = computed(() => {
  const c = props.config || {};
  const servers = (c.dnsConfig && Array.isArray(c.dnsConfig.servers)) ? c.dnsConfig.servers : [];
  return servers
    .map(s => (s && s.address) ? s.address : '')
    .filter(addr => /^\d+\.\d+\.\d+\.\d+$/.test(addr))
    .slice(0, 4);
});

const formatTime = (ts) => {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

async function fetchConfig() {
  try {
    const res = await fetch('/api/router/config');
    const data = await res.json();
    if (data.success && data.config) {
      Object.assign(cfg, data.config);
      // 保证嵌套结构完整
      if (!cfg.dhcp) cfg.dhcp = { enabled: true, rangeStart: '', rangeEnd: '', leaseTimeHours: 24, gateway: '' };
      if (!cfg.macFilter) cfg.macFilter = { mode: 'disabled', addresses: [] };
      if (!Array.isArray(cfg.staticBindings)) cfg.staticBindings = [];
      running.value = !!data.running;
    }
  } catch (e) {
    ElMessage.error(t('router.loadConfigFailed', { msg: e.message }));
  }
}

async function fetchInterfaces() {
  try {
    const res = await fetch('/api/router/interfaces');
    const data = await res.json();
    if (data.success) interfaces.value = data.interfaces || [];
  } catch (e) {}
}

async function fetchDevices() {
  loadingDevices.value = true;
  try {
    const res = await fetch('/api/router/devices');
    const data = await res.json();
    if (data.success) devices.value = data.devices || [];
  } catch (e) {} finally {
    loadingDevices.value = false;
  }
}

async function saveConfig() {
  try {
    const res = await fetch('/api/router/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg)
    });
    const data = await res.json();
    if (data.success) ElMessage.success(t('router.configSaved'));
    else ElMessage.error(data.message || t('router.saveFailed'));
  } catch (e) {
    ElMessage.error(t('router.saveFailed') + ': ' + e.message);
  }
}

async function startRouter() {
  starting.value = true;
  try {
    const res = await fetch('/api/router/start', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      ElMessage.success(t('router.startSuccess'));
      running.value = true;
      fetchDevices();
    } else {
      ElMessage.error(data.message || t('router.startFailed'));
    }
  } catch (e) {
    ElMessage.error(t('router.startFailed') + ': ' + e.message);
  } finally {
    starting.value = false;
  }
}

async function stopRouter() {
  stopping.value = true;
  try {
    const res = await fetch('/api/router/stop', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      ElMessage.success(t('router.stopSuccess'));
      running.value = false;
    } else {
      ElMessage.error(data.message || t('router.stopFailed'));
    }
  } catch (e) {
    ElMessage.error(t('router.stopFailed') + ': ' + e.message);
  } finally {
    stopping.value = false;
  }
}

async function toggleDevice(row) {
  const newEnabled = row.enabled === false;
  try {
    const res = await fetch(`/api/router/devices/${encodeURIComponent(row.mac)}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: newEnabled })
    });
    const data = await res.json();
    if (data.success) {
      ElMessage.success(newEnabled ? t('router.enableSuccess') : t('router.disableSuccess'));
      fetchDevices();
    } else {
      ElMessage.error(data.message || t('router.operationFailed'));
    }
  } catch (e) {
    ElMessage.error(t('router.operationFailed') + ': ' + e.message);
  }
}

async function kickDevice(row) {
  try {
    await ElMessageBox.confirm(t('router.kickConfirm', { mac: row.mac, ip: row.ip }), t('common.warning'), { type: 'warning' });
    const res = await fetch(`/api/router/devices/${encodeURIComponent(row.mac)}/kick`, { method: 'POST' });
    const data = await res.json();
    if (data.success) ElMessage.success(t('router.kickDevice'));
    else ElMessage.error(data.message || t('router.operationFailed'));
    fetchDevices();
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(t('router.operationFailed'));
  }
}

async function deleteDevice(row) {
  try {
    await ElMessageBox.confirm(t('router.deleteConfirm', { mac: row.mac }), t('common.warning'), { type: 'warning' });
    const res = await fetch(`/api/router/devices/${encodeURIComponent(row.mac)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) ElMessage.success(t('common.success'));
    else ElMessage.error(data.message || t('common.failed'));
    fetchDevices();
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(t('common.failed'));
  }
}

function addBinding() {
  if (!Array.isArray(cfg.staticBindings)) cfg.staticBindings = [];
  cfg.staticBindings.push({ mac: '', ip: '', name: '' });
}

// 选中已连接设备时自动填充 IP 和 名称
function onBindingMacChange(binding, val) {
  if (!val) return;
  const dev = devices.value.find(d => d.mac === val);
  if (dev) {
    if (dev.ip && !binding.ip) binding.ip = dev.ip;
    if (dev.hostname && !binding.name) binding.name = dev.hostname;
  }
}

const SOURCE_LABEL = { dhcp: 'DHCP', static: t('router.deviceRegistered'), arp: 'ARP' };
const SOURCE_CLASS = {
  dhcp: 'bt-source-dhcp',
  static: 'bt-source-static',
  arp: 'bt-source-arp'
};
function sourceLabel(s) { return SOURCE_LABEL[s] || (s || '—'); }
function sourceClass(s) { return SOURCE_CLASS[s] || 'text-gray-400'; }

function statusLabel(row) {
  if (row.enabled === false) return t('common.disabled');
  return row.online ? t('router.deviceOnline') : t('router.deviceOffline');
}
function statusClass(row) {
  if (row.enabled === false) return 'bt-status-disabled';
  return row.online ? 'bt-status-online' : 'bt-status-offline';
}

// WS 消息处理
let ws = null;
function setupWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'router_devices') {
        devices.value = msg.data || [];
      } else if (msg.type === 'router_event') {
        // 设备上下线可在此触发通知
      }
    } catch (e) {}
  };
}

onMounted(() => {
  fetchConfig();
  fetchInterfaces();
  fetchDevices();
  setupWs();
});
onUnmounted(() => {
  if (ws) try { ws.close(); } catch (e) {}
});
</script>

<style scoped>
/* 来源颜色 */
.bt-source-dhcp { color: #67c23a; font-weight: 500; }
.bt-source-static { color: #e6a23c; font-weight: 500; }
.bt-source-arp { color: #909399; font-weight: 500; }

/* 状态颜色 */
.bt-status-online { color: #67c23a; font-weight: 600; }
.bt-status-offline { color: #909399; }
.bt-status-disabled { color: #f56c6c; font-weight: 600; }

/* 适配暗色主题 */
:root.dark .bt-source-dhcp,
:root.dark .bt-status-online { color: #95d475; }
:root.dark .bt-source-static { color: #f3c36b; }
:root.dark .bt-source-arp,
:root.dark .bt-status-offline { color: #a6a6a6; }
:root.dark .bt-status-disabled { color: #f0898c; }

html.dark .bt-source-dhcp,
html.dark .bt-status-online { color: #95d475; }
html.dark .bt-source-static { color: #f3c36b; }
html.dark .bt-source-arp,
html.dark .bt-status-offline { color: #a6a6a6; }
html.dark .bt-status-disabled { color: #f0898c; }
</style>
