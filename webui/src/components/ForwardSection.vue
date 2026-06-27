<template>
  <div class="space-y-6">
    <div v-if="mode === 'server'" class="flex justify-between items-center bt-section-status h-[56px] sticky top-[60px] z-10 bg-white dark:bg-gray-900 -mx-6 px-6 pt-4 -mt-4 pb-4">
      <div class="flex items-center gap-3">
        <el-tag :type="isRunning ? 'success' : 'info'" effect="dark" round size="large">
          {{ title }}: {{ isRunning ? '运行中' : '已停止' }}
        </el-tag>
      </div>
      <el-button v-if="!isRunning" type="primary" :icon="VideoPlay" @click="$emit('start')" shadow size="small">
        启动{{ title }}
      </el-button>
      <el-button v-else type="danger" :icon="VideoPause" @click="$emit('stop')" shadow size="small">
        停止{{ title }}
      </el-button>
    </div>
    <el-card v-if="mode === 'server'" shadow="hover" class="bt-card mb-6">
      <div class="flex items-center gap-3 w-full">
        <el-icon :size="22" style="color: var(--bt-primary)"><Guide /></el-icon>
        <div>
          <div class="font-bold text-sm bt-text">服务端模式说明</div>
          <div class="text-xs bt-text-secondary mt-1">
            启动服务端后，远程客户端可通过「隧道端口」和「连接密码」接入本机。
            通过「端口映射」将连接的客户端的服务暴露到本地，通过「客户端管理」查看在线状态。
          </div>
        </div>
      </div>
    </el-card>

    <!-- SERVER MODE: BASE SETTINGS -->
    <template v-if="mode === 'server'">
      <el-card shadow="hover" class="bt-card mb-6">
        <template #header>
          <div class="flex items-center gap-2">
            <el-icon style="color: var(--bt-primary)"><Tools /></el-icon>
            <span class="font-bold text-base bt-text">基础设置</span>
          </div>
        </template>
        
        <el-form label-position="top">
          <div class="bt-info-banner mb-6 flex justify-between items-center">
            <div>
              <div class="font-bold text-sm mb-1" style="color: var(--bt-primary)">自动开启此模式</div>
              <div class="text-xs bt-text-secondary">软件启动后，自动在后台运行</div>
            </div>
            <el-switch v-model="sectionConfig.autoStart" />
          </div>

          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item class="mb-4">
                <template #label>
                  <div class="flex items-center gap-1">
                    <span>连接密码 (身份认证)</span>
                    <el-tooltip content="用于对端设备接入本隧道时的密码验证。" placement="top">
                      <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                    </el-tooltip>
                  </div>
                </template>
                <el-input v-model="sectionConfig.password" placeholder="请输入密码" show-password />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item class="mb-4">
                <template #label>
                  <div class="flex items-center gap-1">
                    <span>绑定 IP (监听地址)</span>
                    <el-tooltip content="服务端安全隧道监听的网卡 IP。" placement="top">
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
                    <span>隧道端口</span>
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
      <div class="bt-section-status flex items-center gap-3 h-[56px] sticky top-[60px] z-10 bg-white dark:bg-gray-900 -mx-6 px-6 pt-4 -mt-4 pb-4">
        <el-tag type="primary" effect="dark" round size="large">
          {{ title }}
        </el-tag>
      </div>
      <el-card shadow="hover" class="bt-card mb-6">
        <div class="flex items-center gap-3 w-full">
          <el-icon :size="22" style="color: var(--bt-primary)"><Guide /></el-icon>
          <div>
            <div class="font-bold text-sm bt-text">客户端模式说明</div>
            <div class="text-xs bt-text-secondary mt-1">
              在下方「服务端连接池」中添加远程服务端的地址、端口与密码，启用后将自动连接。
              连接成功后可通过「端口映射」将远程端口转发到本地使用。
            </div>
          </div>
        </div>
      </el-card>
    </template>

    <!-- PORT FORWARDING RULES (Above client list / connections) -->
    <el-card shadow="hover" class="bt-card mb-6">
      <template #header>
        <div class="flex justify-between items-center">
          <div class="flex items-center gap-2">
            <el-icon class="text-green-500"><Switch /></el-icon>
            <span class="font-bold text-base">端口映射</span>
          </div>
          <el-button type="primary" plain size="small" :icon="Plus" @click="addForward">添加映射</el-button>
        </div>
      </template>

      <el-empty v-if="!sectionConfig.forwards || sectionConfig.forwards.length === 0" description="暂无规则" :image-size="40" />
      
      <div v-else class="space-y-4">
        <div v-for="(fw, index) in sectionConfig.forwards" :key="index" class="p-3 rounded mb-3" style="background: var(--bt-input-bg); border: 1px solid var(--bt-border);">
          <div class="flex justify-between items-center mb-2">
            <span class="text-xs font-bold text-gray-500">映射规则 #{{ index + 1 }}</span>
            <div class="flex items-center gap-2">
              <el-switch v-model="fw.enabled" inline-prompt active-text="已启用" inactive-text="已停用" />
              <el-button type="danger" circle plain :icon="Delete" size="small" @click="sectionConfig.forwards.splice(index, 1)" />
            </div>
          </div>
          
          <div class="flex items-center gap-3 w-full">
            <el-tooltip content="本地监听端口" placement="top">
              <div class="w-28 flex-shrink-0">
                <el-input-number v-model="fw.listenPort" :min="1" :max="65535" class="w-full" :controls="false" size="small" placeholder="本地端口" />
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
                    placeholder="目标客户端 ID"
                    size="small"
                    class="w-full"
                  />
                </div>
              </template>
              <template v-else>
                <div class="w-36 flex-shrink-0">
                  <!-- Client selects which server connection to forward through -->
                  <el-select v-model="fw.targetClientId" placeholder="承载服务端" size="small" class="w-full">
                    <el-option v-for="c in (sectionConfig.connections || [])" :key="c.id" :label="c.alias" :value="c.id" />
                    <!-- Legacy fallback -->
                    <el-option v-if="!(sectionConfig.connections || []).some(c => c.id === fw.targetClientId)" :label="fw.targetClientId" :value="fw.targetClientId" />
                  </el-select>
                </div>
              </template>
              
              <div class="flex-1 max-w-[130px]">
                <el-input v-model="fw.targetHost" placeholder="目标 IP (如: 127.0.0.1)" size="small" />
              </div>
              
              <div class="w-28 flex-shrink-0">
                <el-input-number v-model="fw.targetPort" :min="1" :max="65535" class="w-full" :controls="false" size="small" placeholder="目标端口" />
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
              <span class="font-bold text-base">客户端管理</span>
            </div>
            <el-button type="danger" plain size="small" @click="clearOfflineClients">清理所有离线设备</el-button>
          </div>
        </template>

        <el-table :data="sectionConfig.knownClients || []" style="width: 100%" max-height="300" empty-text="暂无客户端接入记录">
          <el-table-column prop="id" label="客户端 ID" min-width="150" />
          <el-table-column label="状态" width="100">
            <template #default="scope">
              <el-tag :type="scope.row.online ? 'success' : 'info'" size="small">
                {{ scope.row.online ? '在线' : '离线' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="最后连接时间" min-width="150">
            <template #default="scope">
              {{ scope.row.lastConnected ? new Date(scope.row.lastConnected).toLocaleString() : '-' }}
            </template>
          </el-table-column>
          <el-table-column label="累计时长" min-width="120">
            <template #default="scope">
              {{ formatDuration(scope.row.totalDuration || 0) }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="160" fixed="right">
            <template #default="scope">
              <el-button link type="primary" size="small" @click="openClientTraffic(scope.row)">访问详情</el-button>
              <el-button v-if="!scope.row.online" link type="danger" size="small" @click="deleteClient(scope.$index)">删除</el-button>
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
              <span class="font-bold text-base bt-text">服务端连接池</span>
            </div>
            <el-button type="primary" plain size="small" :icon="Plus" @click="addClientConnection">新增连接</el-button>
          </div>
        </template>
        
        <el-empty v-if="!sectionConfig.connections || sectionConfig.connections.length === 0" description="暂无连接，请添加服务端" :image-size="60" />
        
        <div v-else class="space-y-4">
          <div v-for="(conn, index) in sectionConfig.connections" :key="conn.id" class="p-4 rounded-lg border" style="border-color: var(--bt-border); background: var(--bt-surface)">
            <div class="flex justify-between items-center mb-4">
              <div class="flex items-center gap-3">
                <el-input v-model="conn.alias" placeholder="连接别名" size="small" class="w-32 font-bold" @change="$emit('save')" />
                <el-switch v-model="conn.enabled" inline-prompt active-text="已启用" inactive-text="已停用" @change="toggleConnection(conn.id, conn.enabled)" />
                <el-tag v-if="conn.enabled" :type="getConnectionStatus(conn.id).type" size="small" effect="plain" round>
                  {{ getConnectionStatus(conn.id).text }}
                </el-tag>
              </div>
              <el-button type="danger" circle plain :icon="Delete" size="small" @click="deleteClientConnection(index)" />
            </div>
            
            <el-row :gutter="16">
              <el-col :span="12" class="mb-3">
                <div class="text-xs text-gray-500 mb-1">服务端 IP</div>
                <el-input v-model="conn.tunnelHost" placeholder="127.0.0.1" size="small" @change="$emit('save')" />
              </el-col>
              <el-col :span="12" class="mb-3">
                <div class="text-xs text-gray-500 mb-1">隧道端口</div>
                <el-input-number v-model="conn.tunnelPort" :min="1" :max="65535" size="small" class="w-full" :controls="false" @change="$emit('save')" />
              </el-col>
              <el-col :span="12" class="mb-3">
                <div class="text-xs text-gray-500 mb-1">客户端 ID</div>
                <el-input v-model="conn.clientId" placeholder="唯一标识此设备" size="small" @change="$emit('save')" />
              </el-col>
              <el-col :span="12" class="mb-3">
                <div class="text-xs text-gray-500 mb-1">连接密码</div>
                <el-input v-model="conn.password" show-password size="small" placeholder="认证密码" @change="$emit('save')" />
              </el-col>
            </el-row>
          </div>
        </div>
      </el-card>
    </template>

    <!-- Client Traffic Dialog -->
    <el-dialog v-model="trafficDialogVisible" :title="`${currentTrafficClient?.id} 访问详情`" width="70%" destroy-on-close>
      <div v-if="!clientTrafficLogs || clientTrafficLogs.length === 0" class="py-8 text-center text-gray-500">
        暂无该客户端的流量记录
      </div>
      <el-table v-else :data="clientTrafficLogs" style="width: 100%" height="400">
        <el-table-column prop="timestamp" label="时间" width="160">
          <template #default="scope">{{ new Date(scope.row.timestamp).toLocaleTimeString() }}</template>
        </el-table-column>
        <el-table-column prop="module" label="模块" width="150" show-overflow-tooltip />
        <el-table-column prop="target" label="访问目标" min-width="180" show-overflow-tooltip />
        <el-table-column prop="bytesTransferred" label="流量消耗" width="100">
          <template #default="scope">{{ (scope.row.bytesTransferred / 1024).toFixed(1) }} KB</template>
        </el-table-column>
        <el-table-column prop="durationMs" label="耗时" width="90">
          <template #default="scope">{{ scope.row.durationMs }}ms</template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref, inject } from 'vue';
import { ElMessage } from 'element-plus';
import draggable from 'vuedraggable';
import { Delete, Plus, User, Lock, Switch, HelpFilled, InfoFilled, Sort, Right, Setting, Guide, VideoPlay, VideoPause, Tools } from '@element-plus/icons-vue';

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

const getConnectionStatus = (id) => {
  if (!props.status || !props.status.clientConnections) return { type: 'info', text: '未知' };
  const connStatus = props.status.clientConnections.find(c => c.id === id);
  if (!connStatus) return { type: 'info', text: '等待中' };
  switch (connStatus.status) {
    case 'connected': return { type: 'success', text: '已连接' };
    case 'connecting': return { type: 'warning', text: '连接中' };
    case 'failed': return { type: 'danger', text: '连接失败' };
    default: return { type: 'info', text: '已停止' };
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
  sectionConfig.value.forwards.push({ listenPort: 8080, targetHost: '127.0.0.1', targetPort: 80, targetClientId: defaultTargetClient, enabled: true });
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
  if (!ms) return '0分';
  const mins = Math.floor(ms / 60000);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return `${hours}小时${mins % 60}分`;
  return `${mins}分`;
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
    ElMessage.error('加载流量详情失败');
  }
};
</script>

<style scoped>
:deep(.el-input__wrapper) {
  box-shadow: none !important;
  background: transparent !important;
}
</style>
