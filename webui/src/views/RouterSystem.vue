<template>
  <div class="space-y-6">
    <!-- 顶部状态卡 -->
    <el-card shadow="hover" class="bt-card">
      <div class="flex items-center gap-3 mb-4">
        <el-icon :size="22" style="color: var(--bt-primary)"><Share /></el-icon>
        <div class="flex-1">
          <div class="font-bold text-base bt-text">路由系统</div>
          <div class="text-xs bt-text-secondary mt-1">
            把本机变成一台软路由器，给局域网设备分配 IP 并通过指定代理出网。需要管理员/root 权限。
          </div>
        </div>
        <el-tag :type="running ? 'success' : 'info'" effect="dark" round size="large">
          {{ running ? '运行中' : '已停止' }}
        </el-tag>
        <el-button v-if="!running" type="primary" :icon="VideoPlay" :loading="starting" @click="startRouter">启动路由器</el-button>
        <el-button v-else type="danger" :icon="VideoPause" :loading="stopping" @click="stopRouter">停止路由器</el-button>
      </div>

      <el-form label-position="top" class="mt-2">
        <el-row :gutter="16">
          <el-col :span="6">
            <el-form-item class="mb-2">
              <template #label>路由器名称</template>
              <el-input v-model="cfg.name" placeholder="bi-router" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item class="mb-2">
              <template #label>
                <div class="flex items-center gap-1">
                  <span>网卡</span>
                  <el-tooltip content="选择路由器使用的物理网卡，将作为 LAN 口" placement="top">
                    <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                  </el-tooltip>
                </div>
              </template>
              <el-select v-model="cfg.interface" placeholder="选择网卡" filterable style="width: 100%;">
                <el-option
                  label="0.0.0.0 (所有网卡 / 不绑定具体网卡)"
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
                  <span>网段 (CIDR)</span>
                  <el-tooltip content="路由器在该网段的 IP/掩码，例如 192.168.88.1/24" placement="top">
                    <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                  </el-tooltip>
                </div>
              </template>
              <el-input v-model="cfg.subnetCidr" placeholder="192.168.88.1/24" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item class="mb-2">
              <template #label>出口模式</template>
              <el-select v-model="cfg.upstreamMode" style="width: 100%;">
                <el-option label="直连 (仅 NAT)" value="direct" />
                <el-option label="系统代理" value="systemProxy" />
                <el-option label="虚拟网卡 (TUN)" value="tun" />
                <el-option label="指定混合代理" value="proxy" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="24" v-if="cfg.upstreamMode === 'proxy'">
            <el-form-item class="mb-2">
              <template #label>
                <div class="flex items-center gap-1">
                  <span>指定代理</span>
                  <el-tooltip content="选择某个混合代理作为出口；Linux 通过 iptables REDIRECT 接入，Windows 不支持，将自动降级" placement="top">
                    <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                  </el-tooltip>
                </div>
              </template>
              <el-select v-model="cfg.upstreamProxyId" placeholder="选择混合代理" style="width: 100%;">
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
          <el-button type="primary" :icon="Check" @click="saveConfig">保存配置</el-button>
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
              <span class="font-bold text-base bt-text">DHCP 服务</span>
            </div>
            <el-switch v-model="cfg.dhcp.enabled" inline-prompt active-text="启用" inactive-text="关闭" />
          </div>
        </template>
        <el-form label-position="top">
          <el-row :gutter="12">
            <el-col :span="12">
              <el-form-item class="mb-3">
                <template #label>DHCP 范围 - 起</template>
                <el-input v-model="cfg.dhcp.rangeStart" placeholder="192.168.88.100" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item class="mb-3">
                <template #label>DHCP 范围 - 止</template>
                <el-input v-model="cfg.dhcp.rangeEnd" placeholder="192.168.88.200" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item class="mb-3">
                <template #label>租约时长 (小时)</template>
                <el-input-number v-model="cfg.dhcp.leaseTimeHours" :min="1" :max="168" style="width: 100%;" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item class="mb-3">
                <template #label>网关</template>
                <el-input v-model="cfg.dhcp.gateway" placeholder="192.168.88.1" />
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item class="mb-3">
                <template #label>
                  <div class="flex items-center gap-1">
                    <span>DNS</span>
                    <el-tooltip content="自动从导航栏全局 DNS 配置中读取纯 IPv4 地址下发；DoH/TCP 等格式 DHCP 不支持，会被跳过" placement="top">
                      <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                    </el-tooltip>
                  </div>
                </template>
                <div class="text-sm bt-text-secondary">
                  下发 DNS：
                  <span v-if="resolvedDns.length" class="bt-text font-medium">{{ resolvedDns.join(', ') }}</span>
                  <span v-else class="text-gray-400">未配置（将使用默认 223.5.5.5, 1.1.1.1）</span>
                  <span class="ml-2 text-xs text-gray-400">— 在顶部导航栏 DNS 配置中维护</span>
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
            <span class="font-bold text-base bt-text">MAC 过滤</span>
          </div>
        </template>
        <el-form label-position="top">
          <el-form-item class="mb-3">
            <template #label>过滤模式</template>
            <el-radio-group v-model="cfg.macFilter.mode">
              <el-radio-button value="disabled">关闭</el-radio-button>
              <el-radio-button value="whitelist">白名单</el-radio-button>
              <el-radio-button value="blacklist">黑名单</el-radio-button>
            </el-radio-group>
            <div class="text-xs bt-text-secondary mt-1" v-if="cfg.macFilter.mode !== 'disabled'">
              {{ cfg.macFilter.mode === 'whitelist' ? '仅允许以下 MAC 地址的设备接入' : '阻断以下 MAC 地址的设备' }}
            </div>
          </el-form-item>
          <el-form-item v-if="cfg.macFilter.mode !== 'disabled'" class="mb-0">
            <template #label>MAC 列表（每行一个）</template>
            <el-input
              :model-value="cfg.macFilter.addresses.join('\n')"
              @update:model-value="v => cfg.macFilter.addresses = v.split('\n').map(s => s.trim().toUpperCase()).filter(Boolean)"
              type="textarea"
              :rows="6"
              placeholder="AA:BB:CC:DD:EE:FF&#10;11:22:33:44:55:66"
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
            <span class="font-bold text-base bt-text">静态绑定</span>
          </div>
          <el-button type="primary" plain size="small" :icon="Plus" @click="addBinding">添加</el-button>
        </div>
      </template>
      <el-empty v-if="cfg.staticBindings.length === 0" description="暂无静态绑定" :image-size="60" />
      <div v-else class="space-y-2">
        <div v-for="(b, i) in cfg.staticBindings" :key="i" class="flex items-center gap-2">
          <el-select
            v-model="b.mac"
            placeholder="选择设备或输入 MAC"
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
          <el-input v-model="b.ip" placeholder="固定 IP" style="flex: 1;" />
          <el-input v-model="b.name" placeholder="备注名称" style="flex: 1;" />
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
            <span class="font-bold text-base bt-text">已连接设备</span>
            <el-tag size="small" type="info">{{ devices.length }}</el-tag>
          </div>
          <el-button :icon="Refresh" circle plain size="small" @click="fetchDevices" :loading="loadingDevices" />
        </div>
      </template>
      <el-table :data="devices" v-loading="loadingDevices" stripe size="default">
        <el-table-column label="MAC 地址" prop="mac" width="180" />
        <el-table-column label="IP 地址" prop="ip" width="140" />
        <el-table-column label="主机名" prop="hostname" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.hostname">{{ row.hostname }}</span>
            <span v-else class="text-gray-400">—</span>
          </template>
        </el-table-column>
        <el-table-column label="来源" prop="source" width="90">
          <template #default="{ row }">
            <span :class="sourceClass(row.source)">{{ sourceLabel(row.source) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <span :class="statusClass(row)">
              {{ statusLabel(row) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="最后活跃" width="170">
          <template #default="{ row }">
            {{ row.lastSeen ? formatTime(row.lastSeen) : '—' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220">
          <template #default="{ row }">
            <el-button
              size="small"
              :type="row.enabled === false ? 'success' : 'warning'"
              plain
              @click="toggleDevice(row)"
            >
              {{ row.enabled === false ? '启用' : '禁用' }}
            </el-button>
            <el-button size="small" type="danger" plain @click="kickDevice(row)">踢下线</el-button>
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
      label: `${p.name || '未命名'} (端口: ${p.listenPort})`
    }));
  }
  if (c.client && Array.isArray(c.client.proxies)) {
    c.client.proxies.forEach(p => list.push({
      id: p.id,
      label: `${p.name || '未命名'} (端口: ${p.listenPort})`
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
    ElMessage.error('加载路由器配置失败: ' + e.message);
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
    if (data.success) ElMessage.success('配置已保存');
    else ElMessage.error(data.message || '保存失败');
  } catch (e) {
    ElMessage.error('保存失败: ' + e.message);
  }
}

async function startRouter() {
  starting.value = true;
  try {
    const res = await fetch('/api/router/start', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      ElMessage.success('路由器已启动');
      running.value = true;
      fetchDevices();
    } else {
      ElMessage.error(data.message || '启动失败');
    }
  } catch (e) {
    ElMessage.error('启动失败: ' + e.message);
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
      ElMessage.success('路由器已停止');
      running.value = false;
    } else {
      ElMessage.error(data.message || '停止失败');
    }
  } catch (e) {
    ElMessage.error('停止失败: ' + e.message);
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
      ElMessage.success(newEnabled ? '已启用' : '已禁用');
      fetchDevices();
    } else {
      ElMessage.error(data.message || '操作失败');
    }
  } catch (e) {
    ElMessage.error('操作失败: ' + e.message);
  }
}

async function kickDevice(row) {
  try {
    await ElMessageBox.confirm(`确定将设备 ${row.mac} (${row.ip}) 踢下线？`, '提示', { type: 'warning' });
    const res = await fetch(`/api/router/devices/${encodeURIComponent(row.mac)}/kick`, { method: 'POST' });
    const data = await res.json();
    if (data.success) ElMessage.success('已踢下线');
    else ElMessage.error(data.message || '操作失败');
    fetchDevices();
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('操作失败');
  }
}

async function deleteDevice(row) {
  try {
    await ElMessageBox.confirm(`确定从列表中删除设备 ${row.mac}？`, '提示', { type: 'warning' });
    const res = await fetch(`/api/router/devices/${encodeURIComponent(row.mac)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) ElMessage.success('已删除');
    else ElMessage.error(data.message || '删除失败');
    fetchDevices();
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('删除失败');
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

const SOURCE_LABEL = { dhcp: 'DHCP', static: '静态', arp: 'ARP' };
const SOURCE_CLASS = {
  dhcp: 'bt-source-dhcp',
  static: 'bt-source-static',
  arp: 'bt-source-arp'
};
function sourceLabel(s) { return SOURCE_LABEL[s] || (s || '—'); }
function sourceClass(s) { return SOURCE_CLASS[s] || 'text-gray-400'; }

function statusLabel(row) {
  if (row.enabled === false) return '已禁用';
  return row.online ? '在线' : '离线';
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
