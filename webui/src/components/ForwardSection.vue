<template>
  <div class="space-y-6">
    <!-- SERVER MODE: DESCRIPTION CARD WITH STATUS -->
    <el-card v-if="mode === 'server'" shadow="hover" class="bt-card mb-6">
      <div class="flex items-center gap-3 w-full mb-4">
        <el-icon :size="22" style="color: var(--bt-primary)"><Guide /></el-icon>
        <div>
          <div class="font-bold text-sm bt-text">{{ t('forward.serverModeDesc') }}</div>
          <div class="text-xs bt-text-secondary mt-1">
            {{ t('forward.serverModeDescBody') }}
          </div>
        </div>
      </div>
      <div class="flex justify-between items-center pt-3" style="border-top: 1px solid var(--bt-border);">
        <el-tag :type="isRunning ? 'success' : 'info'" effect="dark" round size="large">
          {{ title }}: {{ isRunning ? t('common.running') : t('common.stopped') }}
        </el-tag>
        <el-button v-if="!isRunning" type="primary" :icon="VideoPlay" @click="$emit('start')" shadow size="small">
          {{ t('forward.start') }}{{ title }}
        </el-button>
        <el-button v-else type="danger" :icon="VideoPause" @click="$emit('stop')" shadow size="small">
          {{ t('forward.stop') }}{{ title }}
        </el-button>
      </div>
    </el-card>

    <!-- SERVER MODE: BASE SETTINGS -->
    <template v-if="mode === 'server'">
      <el-card shadow="hover" class="bt-card mb-6">
        <template #header>
          <div class="flex items-center gap-2">
            <el-icon style="color: var(--bt-primary)"><Tools /></el-icon>
            <span class="font-bold text-base bt-text">{{ t('forward.baseSettings') }}</span>
          </div>
        </template>

        <el-form label-position="top">
          <div class="bt-info-banner mb-6 flex justify-between items-center">
            <div>
              <div class="font-bold text-sm mb-1" style="color: var(--bt-primary)">{{ t('forward.autoStartMode') }}</div>
              <div class="text-xs bt-text-secondary">{{ t('forward.autoStartModeDesc') }}</div>
            </div>
            <el-switch v-model="sectionConfig.autoStart" />
          </div>

          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item class="mb-4">
                <template #label>
                  <div class="flex items-center gap-1">
                    <span>{{ t('forward.connectionPassword') }}</span>
                    <el-tooltip :content="t('forward.connectionPasswordTooltip')" placement="top">
                      <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                    </el-tooltip>
                  </div>
                </template>
                <el-input v-model="sectionConfig.password" :placeholder="t('forward.passwordPlaceholder')" show-password />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item class="mb-4">
                <template #label>
                  <div class="flex items-center gap-1">
                    <span>{{ t('forward.bindIp') }}</span>
                    <el-tooltip :content="t('forward.bindIpTooltip')" placement="top">
                      <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                    </el-tooltip>
                  </div>
                </template>
                <el-autocomplete
                  v-model="sectionConfig.bindHost"
                  :fetch-suggestions="(q, cb) => cb(availableIps.map(ip => ({ value: ip })))"
                  placeholder="0.0.0.0"
                  class="w-full"
                />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item class="mb-4">
                <template #label>
                  <div class="flex items-center gap-1">
                    <span>{{ t('forward.tunnelPort') }}</span>
                  </div>
                </template>
                <el-input-number v-model="sectionConfig.tunnelPort" :min="1" :max="65535" class="w-full" controls-position="right" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>
      </el-card>
    </template>

    <!-- CLIENT MODE: HEADER BANNER -->
    <template v-else>
      <el-card shadow="hover" class="bt-card mb-6">
        <div class="flex items-center gap-3 w-full mb-4">
          <el-icon :size="22" style="color: var(--bt-primary)"><Guide /></el-icon>
          <div>
            <div class="font-bold text-sm bt-text">{{ t('forward.clientModeDesc') }}</div>
            <div class="text-xs bt-text-secondary mt-1">
              {{ t('forward.clientModeDescBody') }}
            </div>
          </div>
        </div>
        <div class="flex items-center pt-3" style="border-top: 1px solid var(--bt-border);">
          <el-tag type="primary" effect="dark" round size="large">
            {{ title }}
          </el-tag>
        </div>
      </el-card>
    </template>

    <!-- PORT FORWARDING RULES (Above client list / connections) -->
    <el-card shadow="hover" class="bt-card mb-6">
      <template #header>
        <div class="flex justify-between items-center">
          <div class="flex items-center gap-2">
            <el-icon class="text-green-500"><Switch /></el-icon>
            <span class="font-bold text-base">{{ t('forward.portForwarding') }}</span>
          </div>
          <el-button type="primary" plain size="small" :icon="Plus" @click="addForward">{{ t('forward.addForward') }}</el-button>
        </div>
      </template>

      <el-empty v-if="!sectionConfig.forwards || sectionConfig.forwards.length === 0" :description="t('common.empty')" :image-size="40" />

      <div v-else class="space-y-4">
        <div v-for="(fw, index) in sectionConfig.forwards" :key="index" class="p-3 rounded mb-3" style="background: var(--bt-input-bg); border: 1px solid var(--bt-border);">
          <div class="flex justify-between items-center mb-2">
            <span class="text-xs font-bold text-gray-500">{{ t('forward.forwardRule') }} #{{ index + 1 }}</span>
            <div class="flex items-center gap-2">
              <el-switch v-model="fw.enabled" inline-prompt :active-text="t('common.enabled')" :inactive-text="t('forward.stopped')" @change="toggleForward(fw)" />
              <el-button type="danger" circle plain :icon="Delete" size="small" @click="sectionConfig.forwards.splice(index, 1)" />
            </div>
          </div>

          <div class="flex items-center gap-3 w-full">
            <el-tooltip :content="t('forward.localListenPort')" placement="top">
              <div class="w-28 flex-shrink-0">
                <el-input-number v-model="fw.listenPort" :min="1" :max="65535" class="w-full" :controls="false" size="small" :placeholder="t('forward.localPort')" @change="validatePortUnique(fw.listenPort, fw)" />
              </div>
            </el-tooltip>

            <el-icon class="text-gray-400 flex-shrink-0"><Right /></el-icon>

            <div class="flex-1 flex gap-2 overflow-hidden">
              <template v-if="mode === 'server'">
                <div class="w-36 flex-shrink-0">
                  <!-- Server selects which client to forward to -->
                  <el-autocomplete
                    v-model="fw.targetClientId"
                    :fetch-suggestions="(q, cb) => cb((sectionConfig.knownClients || []).map(c => ({ value: c.id })))"
                    :placeholder="t('forward.targetClientId')"
                    size="small"
                    class="w-full"
                  />
                </div>
              </template>
              <template v-else>
                <div class="w-36 flex-shrink-0">
                  <!-- Client selects which server connection to forward through -->
                  <el-select v-model="fw.targetClientId" :placeholder="t('forward.carrierServer')" size="small" class="w-full">
                    <el-option v-for="c in (sectionConfig.connections || [])" :key="c.id" :label="c.alias" :value="c.id" />
                    <!-- Legacy fallback -->
                    <el-option v-if="!(sectionConfig.connections || []).some(c => c.id === fw.targetClientId)" :label="fw.targetClientId" :value="fw.targetClientId" />
                  </el-select>
                </div>
              </template>

              <div class="flex-1 max-w-[130px]">
                <el-input v-model="fw.targetHost" :placeholder="t('forward.targetIp')" size="small" />
              </div>

              <div class="w-28 flex-shrink-0">
                <el-input-number v-model="fw.targetPort" :min="1" :max="65535" class="w-full" :controls="false" size="small" :placeholder="t('forward.targetPort')" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </el-card>

    <!-- SERVER MODE: CLIENT MANAGEMENT (At bottom) -->
    <template v-if="mode === 'server'">
      <el-card shadow="hover" class="bt-card">
        <template #header>
          <div class="flex justify-between items-center">
            <div class="flex items-center gap-2">
              <el-icon class="text-blue-500"><User /></el-icon>
              <span class="font-bold text-base">{{ t('forward.clientManagement') }}</span>
            </div>
            <el-button type="danger" plain size="small" @click="clearOfflineClients">{{ t('forward.clearOffline') }}</el-button>
          </div>
        </template>

        <el-table :data="sectionConfig.knownClients || []" style="width: 100%" max-height="300" :empty-text="t('forward.noClientRecords')">
          <el-table-column prop="id" :label="t('forward.clientId')" min-width="150" />
          <el-table-column :label="t('common.status')" width="100">
            <template #default="scope">
              <span :class="['status-text', scope.row.online ? 'status-online' : 'status-offline']">
                {{ scope.row.online ? t('forward.online') : t('forward.offline') }}
              </span>
            </template>
          </el-table-column>
          <el-table-column :label="t('forward.lastConnected')" min-width="150">
            <template #default="scope">
              {{ scope.row.lastConnected ? new Date(scope.row.lastConnected).toLocaleString() : '-' }}
            </template>
          </el-table-column>
          <el-table-column :label="t('forward.totalDuration')" min-width="120">
            <template #default="scope">
              {{ formatDuration(scope.row.totalDuration || 0) }}
            </template>
          </el-table-column>
          <el-table-column :label="t('common.action')" width="160" fixed="right">
            <template #default="scope">
              <el-button link type="primary" size="small" @click="openClientTraffic(scope.row)">{{ t('forward.trafficDetail') }}</el-button>
              <el-button v-if="!scope.row.online" link type="danger" size="small" @click="deleteClient(scope.$index)">{{ t('common.delete') }}</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>

    <!-- CLIENT MODE: SERVER CONNECTION POOL (At bottom) -->
    <template v-else>
      <el-card shadow="hover" class="bt-card">
        <template #header>
          <div class="flex justify-between items-center">
            <div class="flex items-center gap-2">
              <el-icon style="color: var(--bt-primary)"><Tools /></el-icon>
              <span class="font-bold text-base bt-text">{{ t('forward.serverPool') }}</span>
            </div>
            <el-button type="primary" plain size="small" :icon="Plus" @click="addClientConnection">{{ t('forward.addConnection') }}</el-button>
          </div>
        </template>

        <el-empty v-if="!sectionConfig.connections || sectionConfig.connections.length === 0" :description="t('forward.noConnections')" :image-size="60" />

        <div v-else class="space-y-4">
          <div v-for="(conn, index) in sectionConfig.connections" :key="conn.id" class="p-4 rounded-lg border" style="border-color: var(--bt-border); background: var(--bt-surface)">
            <div class="flex justify-between items-center mb-4">
              <div class="flex items-center gap-3">
                <el-input v-model="conn.alias" :placeholder="t('forward.connectionAlias')" size="small" class="w-32 font-bold" @change="$emit('save')" />
                <el-switch v-model="conn.enabled" inline-prompt :active-text="t('common.enabled')" :inactive-text="t('forward.stopped')" @change="toggleConnection(conn.id, conn.enabled)" />
                <el-tag v-if="conn.enabled" :type="getConnectionStatus(conn.id).type" size="small" effect="plain" round>
                  {{ getConnectionStatus(conn.id).text }}
                </el-tag>
              </div>
              <el-button type="danger" circle plain :icon="Delete" size="small" @click="deleteClientConnection(index)" />
            </div>

            <el-row :gutter="16">
              <el-col :span="12" class="mb-3">
                <div class="text-xs text-gray-500 mb-1">{{ t('forward.serverIp') }}</div>
                <el-input v-model="conn.tunnelHost" placeholder="127.0.0.1" size="small" @change="$emit('save')" />
              </el-col>
              <el-col :span="12" class="mb-3">
                <div class="text-xs text-gray-500 mb-1">{{ t('forward.tunnelPort') }}</div>
                <el-input-number v-model="conn.tunnelPort" :min="1" :max="65535" size="small" class="w-full" :controls="false" @change="$emit('save')" />
              </el-col>
              <el-col :span="12" class="mb-3">
                <div class="text-xs text-gray-500 mb-1">{{ t('forward.clientId') }}</div>
                <el-input v-model="conn.clientId" :placeholder="t('forward.clientIdPlaceholder')" size="small" @change="$emit('save')" />
              </el-col>
              <el-col :span="12" class="mb-3">
                <div class="text-xs text-gray-500 mb-1">{{ t('forward.connectionPassword') }}</div>
                <el-input v-model="conn.password" show-password size="small" :placeholder="t('forward.passwordPlaceholder')" @change="$emit('save')" />
              </el-col>
            </el-row>
          </div>
        </div>
      </el-card>
    </template>

    <!-- Client Traffic Dialog -->
    <el-dialog v-model="trafficDialogVisible" :title="t('forward.trafficDetailTitle', { id: currentTrafficClient?.id })" width="70%" destroy-on-close>
      <div v-if="!clientTrafficLogs || clientTrafficLogs.length === 0" class="py-8 text-center text-gray-500">
        {{ t('forward.noTrafficForClient') }}
      </div>
      <el-table v-else :data="clientTrafficLogs" style="width: 100%" height="400">
        <el-table-column prop="timestamp" :label="t('logs.time')" width="160">
          <template #default="scope">{{ new Date(scope.row.timestamp).toLocaleTimeString() }}</template>
        </el-table-column>
        <el-table-column prop="module" :label="t('logs.module')" width="150" show-overflow-tooltip />
        <el-table-column prop="target" :label="t('logs.target')" min-width="180" show-overflow-tooltip />
        <el-table-column prop="bytesTransferred" :label="t('logs.bytes')" width="100">
          <template #default="scope">{{ (scope.row.bytesTransferred / 1024).toFixed(1) }} KB</template>
        </el-table-column>
        <el-table-column prop="durationMs" :label="t('logs.duration')" width="90">
          <template #default="scope">{{ scope.row.durationMs }}ms</template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref, inject, onMounted, onBeforeUnmount } from 'vue';
import { ElMessage } from 'element-plus';
import draggable from 'vuedraggable';
import { Delete, Plus, User, Lock, Switch, HelpFilled, InfoFilled, Sort, Right, Setting, Guide, VideoPlay, VideoPause, Tools } from '@element-plus/icons-vue';
import { t } from '../i18n';

const props = defineProps({
  mode: String,
  title: String,
  config: Object,
  status: Object,
  availableIps: {
    type: Array,
    default: () => ['0.0.0.0', '127.0.0.1']
  }
});

const emit = defineEmits(['start', 'stop', 'save']);

const sendWsMessage = inject('sendWsMessage', (msg) => {
  console.warn('sendWsMessage not provided, falling back to direct save');
  emit('save');
});

// 监听后端推送的端口冲突错误，回滚对应开关并提示
const onForwardError = inject('onForwardError', null);
let unregisterForwardError = null;
onMounted(() => {
  if (onForwardError) {
    unregisterForwardError = onForwardError((data) => {
      if (data.mode !== props.mode) return;
      ElMessage.error(data.message || t('forward.portInUseFailed', { port: data.port }));
      // 回滚服务端 forwards 开关
      if (sectionConfig.value.forwards) {
        const fw = sectionConfig.value.forwards.find(f => f.listenPort === data.port);
        if (fw) {
          fw.enabled = false;
          sendWsMessage({ type: props.mode + '_forward_toggle', listenPort: data.port, enabled: false });
          return;
        }
      }
      // 回滚客户端 connections 开关（客户端的本地端口由后端反向建立，端口冲突时也回滚）
      if (sectionConfig.value.connections) {
        const conn = sectionConfig.value.connections.find(c => c.listenPort === data.port);
        if (conn) {
          conn.enabled = false;
          sendWsMessage({ type: 'client_connection_toggle', id: conn.id, enabled: false });
        }
      }
    });
  }
});
onBeforeUnmount(() => {
  if (unregisterForwardError) unregisterForwardError();
});

// 收集所有模式（server+client）中已占用的本地端口，用于即时冲突预检
// onlyEnabled=true 时只收集已启用的规则端口（用于启用前严格预检）
const getUsedPorts = (excludeObj, onlyEnabled = false) => {
  const used = new Map(); // port -> label
  const isOccupied = (item) => onlyEnabled ? (item.enabled !== false && item.listenPort) : item.listenPort;
  const collect = (modeCfg, modeLabel) => {
    if (!modeCfg) return;
    if (modeCfg.forwards) {
      modeCfg.forwards.forEach((f, i) => {
        if (f !== excludeObj && isOccupied(f)) {
          used.set(f.listenPort, `${modeLabel}${t('forward.forwardUnit')}#${i + 1}`);
        }
      });
    }
    if (modeCfg.connections) {
      modeCfg.connections.forEach((c, i) => {
        if (c !== excludeObj && isOccupied(c)) {
          used.set(c.listenPort, `${modeLabel}${t('forward.connUnit')}#${i + 1}(${c.alias || c.id})`);
        }
      });
    }
  };
  collect(props.config.server, t('proxies.serverLabel'));
  collect(props.config.client, t('proxies.clientLabel'));
  // 还要考虑代理端口
  const collectProxies = (modeCfg, modeLabel) => {
    if (modeCfg && modeCfg.proxies) {
      modeCfg.proxies.forEach((p, i) => {
        if (p !== excludeObj && isOccupied(p)) {
          used.set(p.listenPort, `${modeLabel}${t('proxies.proxyUnit')}#${i + 1}(${p.name || ''})`);
        }
      });
    }
  };
  collectProxies(props.config.server, t('proxies.serverLabel'));
  collectProxies(props.config.client, t('proxies.clientLabel'));
  return used;
};

// 端口输入即时校验
const validatePortUnique = (port, currentObj) => {
  if (!port) return;
  const used = getUsedPorts(currentObj);
  if (used.has(port)) {
    ElMessage.warning(t('forward.portConflictWarning', { port, name: used.get(port) }));
  }
};

const getConnectionStatus = (id) => {
  if (!props.status || !props.status.clientConnections) return { type: 'info', text: t('forward.unknown') };
  const connStatus = props.status.clientConnections.find(c => c.id === id);
  if (!connStatus) return { type: 'info', text: t('forward.waiting') };
  switch (connStatus.status) {
    case 'connected': return { type: 'success', text: t('forward.connected') };
    case 'connecting': return { type: 'warning', text: t('forward.connecting') };
    case 'failed': return { type: 'danger', text: t('forward.connectionFailed') };
    default: return { type: 'info', text: t('common.stopped') };
  }
};

const sectionConfig = computed(() => {
  return props.mode === 'server' ? props.config.server : props.config.client;
});

const isRunning = computed(() => {
  return props.mode === 'server' ? props.status.serverRunning : props.status.clientRunning;
});

const addForward = () => {
  if (!sectionConfig.value.forwards) sectionConfig.value.forwards = [];
  const defaultTargetClient = props.mode === 'server' ? '' : (sectionConfig.value.connections?.[0]?.id || 'default');
  // 自动寻找未占用的端口
  const used = getUsedPorts(null);
  let newPort = 8080;
  while (used.has(newPort)) newPort++;
  sectionConfig.value.forwards.push({ listenPort: newPort, targetHost: '127.0.0.1', targetPort: 80, targetClientId: defaultTargetClient, enabled: false });
};

const addClientConnection = () => {
  const newConn = {
    id: Math.random().toString(36).substr(2, 9),
    alias: '',
    tunnelHost: '127.0.0.1',
    tunnelPort: 33891,
    clientId: '',
    password: 'admin',
    enabled: false
  };
  sendWsMessage({ type: 'client_connection_add', connection: newConn });
};

const toggleConnection = (connId, enabled) => {
  sendWsMessage({ type: 'client_connection_toggle', id: connId, enabled });
};

// 服务端/客户端 forwards 开关切换：启用前预检端口冲突，冲突则阻止并回滚
const toggleForward = (fw) => {
  if (fw.enabled) {
    // 启用前严格预检：只检查其他已启用规则的端口
    const used = getUsedPorts(fw, true);
    if (used.has(fw.listenPort)) {
      ElMessage.error(t('forward.portInUse', { port: fw.listenPort, name: used.get(fw.listenPort) }));
      // 回滚开关为禁用
      fw.enabled = false;
      return;
    }
  }
  sendWsMessage({ type: props.mode + '_forward_toggle', listenPort: fw.listenPort, enabled: fw.enabled });
};

const deleteClientConnection = (index) => {
  const conn = sectionConfig.value.connections?.[index];
  if (conn) {
    sendWsMessage({ type: 'client_connection_delete', id: conn.id });
  }
};

const clearOfflineClients = () => {
  sendWsMessage({ type: 'client_clear_offline' });
};

const deleteClient = (index) => {
  const client = sectionConfig.value.knownClients?.[index];
  if (client) {
    sendWsMessage({ type: 'client_delete', clientId: client.id });
  }
};

const formatDuration = (ms) => {
  if (!ms) return t('forward.durationZero');
  const mins = Math.floor(ms / 60000);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return t('forward.durationHoursMins', { hours, mins: mins % 60 });
  return t('forward.durationMins', { mins });
};

// Traffic Logs Dialog
const trafficDialogVisible = ref(false);
const currentTrafficClient = ref(null);
const clientTrafficLogs = ref([]);

const openClientTraffic = async (client) => {
  currentTrafficClient.value = client;
  trafficDialogVisible.value = true;
  try {
    const res = await fetch(`/api/traffic-logs?limit=100&clientId=${client.id}`);
    const data = await res.json();
    clientTrafficLogs.value = data.logs || [];
  } catch (e) {
    ElMessage.error(t('forward.loadTrafficFailed'));
  }
};
</script>

<style scoped>
:deep(.el-input__wrapper) {
  box-shadow: none !important;
  background: transparent !important;
}

/* 客户端状态纯文字颜色区分 */
.status-text {
  font-size: 12px;
  font-weight: 600;
}
.status-online {
  color: var(--bt-success);
}
.status-offline {
  color: var(--bt-text-muted);
}
</style>
