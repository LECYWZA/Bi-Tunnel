<template>
  <div class="traffic-logs-page">
    <!-- Search bar (fixed) -->
    <div class="logs-toolbar">
      <div class="toolbar-left">
        <el-icon class="text-blue-500"><Document /></el-icon>
        <span class="font-bold text-base">{{ t('logs.title') }}</span>
        <el-tag v-if="autoRefresh" type="success" size="small" effect="plain" round>实时</el-tag>
        <el-tag v-else type="info" size="small" effect="plain" round>已暂停</el-tag>
      </div>
      <div class="toolbar-right">
        <el-switch v-model="autoRefresh" inline-prompt :active-text="t('logs.realtime')" :inactive-text="t('logs.pause')" @change="onRealtimeChange" />
        <el-button size="small" :icon="Delete" @click="clearLogs" plain>清空</el-button>
      </div>
    </div>

    <div class="filter-bar">
      <el-input v-model="searchQuery.target" :placeholder="t('logs.searchTarget')" size="small" style="width: 200px;" class="shrink-0" clearable @change="fetchLogs" />
      <el-input v-model="searchQuery.sourceIp" :placeholder="t('logs.searchSourceIp')" size="small" style="width: 120px;" class="shrink-0" clearable @change="fetchLogs" />
      <el-input v-model="searchQuery.rulePattern" :placeholder="t('logs.searchRulePattern')" size="small" style="width: 150px;" class="shrink-0" clearable @change="fetchLogs" />
      <el-select v-model="searchQuery.action" :placeholder="t('logs.policy')" size="small" style="width: 120px;" class="shrink-0" clearable @change="fetchLogs">
        <el-option :label="t('logs.direct')" value="direct_local" />
        <el-option :label="t('logs.tunnel')" value="direct_remote" />
        <el-option :label="t('nav.chains')" value="proxy_chain" />
        <el-option :label="t('logs.block')" value="block" />
      </el-select>
      <el-select v-model="searchQuery.module" :placeholder="t('logs.module')" size="small" style="width: 110px;" class="shrink-0" clearable @change="fetchLogs">
        <el-option label="系统代理" value="Proxy" />
        <el-option label="虚拟网卡" value="Forward" />
      </el-select>
      <el-select v-model="searchQuery.status" :placeholder="t('logs.status')" size="small" style="width: 100px;" class="shrink-0" clearable @change="fetchLogs">
        <el-option :label="t('logs.success')" value="success" />
        <el-option :label="t('logs.failed')" value="failed" />
      </el-select>
    </div>

    <!-- Table (scrollable content) -->
    <div class="table-wrapper">
      <el-table
        :data="logs"
        style="width: 100%"
        v-loading="loading"
        size="small"
        border
        stripe
        height="100%"
        :row-class-name="rowClassName"
        :default-sort="{ prop: 'id', order: 'descending' }"
      >
        <el-table-column prop="id" :label="t('logs.id')" width="65" align="center" sortable />
        <el-table-column :label="t('logs.time')" width="155" sortable prop="timestamp">
          <template #default="{ row }">
            {{ new Date(row.timestamp).toLocaleString() }}
          </template>
        </el-table-column>
        <el-table-column prop="module" :label="t('logs.module')" width="100" align="center">
          <template #default="{ row }">
            <span :class="['module-text', moduleClass(row.module)]">{{ moduleLabel(row.module) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="sourceIp" label="源 IP" width="130" />
        <el-table-column prop="target" :label="t('logs.targetChain')" min-width="280">
          <template #default="{ row }">
            <div class="flex flex-col gap-1.5 py-1">
              <div class="flex items-center justify-between">
                <span class="font-mono text-xs font-bold text-gray-700 dark:text-gray-300">{{ row.target }}</span>
                <el-button
                  type="primary"
                  link
                  size="small"
                  :icon="Plus"
                  :title="t('logs.quickAddTitle')"
                  @click="openQuickAddDialog(row.target)"
                />
              </div>
              <div v-if="row.routePath && row.routePath.length > 0" class="flex flex-wrap items-center gap-1 text-[11px] route-path-container">
                <template v-for="(node, idx) in row.routePath" :key="idx">
                  <span v-if="idx > 0" class="mx-0.5 route-path-arrow">→</span>
                  <span
                    :class="[
                      'route-hop',
                      node === '本机' ? 'route-hop-local' :
                      node === '直连' ? 'route-hop-direct' :
                      node === '隧道' || node === '隧道转发' || node === '隧道反向代理' ? 'route-hop-tunnel' :
                      node === '拦截' ? 'route-hop-block' :
                      idx === row.routePath.length - 1 ? 'route-hop-target' :
                      'route-hop-node'
                    ]"
                    :title="translateNode(node)"
                  >
                    {{ translateNode(node) }}
                  </span>
                </template>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="action" :label="t('logs.policy')" width="110" align="center">
          <template #default="{ row }">
            <span :class="['action-text', actionClass(row.action)]" :title="row.rulePattern ? `匹配规则: ${row.rulePattern}` : ''">{{ actionLabel(row.action) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="rulePattern" label="匹配规则" width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="text-xs text-gray-500">{{ row.rulePattern || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('logs.duration')" width="75" align="right">
          <template #default="{ row }">
            {{ row.durationMs }} ms
          </template>
        </el-table-column>
        <el-table-column :label="t('logs.traffic')" width="90" align="right">
          <template #default="{ row }">
            {{ formatBytes(row.bytesTransferred) }}
          </template>
        </el-table-column>
        <el-table-column prop="status" :label="t('logs.status')" width="70" align="center">
          <template #default="{ row }">
            <span :class="['status-text', row.status === 'success' ? 'status-success' : 'status-failed']">
              {{ row.status === 'success' ? t('logs.success') : t('logs.failed') }}
            </span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- Pagination (fixed at bottom) -->
    <div class="pagination-bar">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[50, 100, 200, 500]"
        layout="total, sizes, prev, pager, next, jumper"
        :total="total"
        @size-change="fetchLogs"
        @current-change="fetchLogs"
        small
      />
    </div>

    <!-- Quick Add to Rule Card Dialog -->
    <el-dialog v-model="quickAddDialogVisible" :title="t('logs.quickAddTitle')" width="550px" destroy-on-close>
      <div v-if="!config.ruleCards || config.ruleCards.length === 0" class="text-center py-4">
        <div class="text-gray-500 mb-3">{{ t('logs.quickAddEmpty') }}</div>
        <el-button type="primary" size="small" @click="$router.push('/rules')">{{ t('logs.quickAddGoto') }}</el-button>
      </div>
      <div v-else>
        <el-form label-position="top" size="small">
          <el-form-item :label="t('logs.quickAddTarget')">
            <el-input v-model="quickAddHost" readonly disabled />
          </el-form-item>
          <el-form-item :label="t('logs.quickAddSelect')" required>
            <el-select v-model="selectedCardId" placeholder="选择规则卡片" @change="loadCardData" style="width: 100%;" filterable>
              <el-option v-for="card in config.ruleCards" :key="card.id" :label="card.name" :value="card.id" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('logs.quickAddPreview')">
            <el-input
              type="textarea"
              v-model="quickAddForm.text"
              :rows="8"
              placeholder="卡片规则内容，一行一条"
              style="font-family: monospace;"
            />
            <div class="text-xs text-blue-500 mt-1">
              {{ t('logs.quickAddTip') }}
            </div>
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="quickAddDialogVisible = false" size="small">{{ t('common.cancel') }}</el-button>
          <el-button type="primary" :disabled="!selectedCardId" @click="saveQuickAdd" size="small">{{ t('common.confirm') }}</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, onActivated, onDeactivated, inject } from 'vue';
import { Document, Plus, Delete } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { t } from '../i18n';

defineOptions({ name: 'TrafficLogs' });

const props = defineProps({
  config: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(['save']);

const logs = ref([]);
const total = ref(0);
const loading = ref(false);
const currentPage = ref(1);
const pageSize = ref(100);
const autoRefresh = ref(true);

// Track newest log id for new-row animation
const newestId = ref(0);
const newRowIds = ref(new Set());

const searchQuery = ref({
  target: '',
  action: '',
  module: '',
  sourceIp: '',
  status: '',
  rulePattern: ''
});

const sendWsMessage = inject('sendWsMessage', null);
const onTrafficLog = inject('onTrafficLog', null);
let unsubscribeTrafficLog = null;

const fetchLogs = async () => {
  if (loading.value) return;
  loading.value = true;
  try {
    const offset = (currentPage.value - 1) * pageSize.value;
    const query = new URLSearchParams({ limit: pageSize.value, offset });
    if (searchQuery.value.target) query.append('target', searchQuery.value.target);
    if (searchQuery.value.action) query.append('action', searchQuery.value.action);
    if (searchQuery.value.module) query.append('module', searchQuery.value.module);
    if (searchQuery.value.sourceIp) query.append('sourceIp', searchQuery.value.sourceIp);
    if (searchQuery.value.status) query.append('status', searchQuery.value.status);
    if (searchQuery.value.rulePattern) query.append('rulePattern', searchQuery.value.rulePattern);

    const res = await fetch(`/api/traffic-logs?${query.toString()}`);
    const data = await res.json();
    logs.value = data.logs;
    total.value = data.total;
    if (logs.value.length > 0) {
      newestId.value = logs.value[0].id;
    }
  } catch (e) {
    console.error('Failed to fetch logs:', e);
  } finally {
    loading.value = false;
  }
};

// Subscribe / unsubscribe to WS traffic log push
const subscribeWs = () => {
  if (sendWsMessage) {
    sendWsMessage({ type: 'traffic_subscribe' });
  }
};

const unsubscribeWs = () => {
  if (sendWsMessage) {
    sendWsMessage({ type: 'traffic_unsubscribe' });
  }
};

// Toggle backend recording
const setRecording = async (enabled) => {
  try {
    await fetch('/api/traffic-logs/recording', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
  } catch (e) {
    console.error('Failed to toggle recording:', e);
  }
};

const onRealtimeChange = async (val) => {
  if (val) {
    // Turn on: subscribe WS + enable recording + fetch latest
    subscribeWs();
    await setRecording(true);
    currentPage.value = 1;
    await fetchLogs();
  } else {
    // Turn off: unsubscribe WS + disable recording
    unsubscribeWs();
    await setRecording(false);
  }
};

const clearLogs = async () => {
  try {
    await ElMessageBox.confirm('确定清空所有审计日志吗？此操作不可恢复。', '清空确认', {
      confirmButtonText: '确定清空',
      cancelButtonText: '取消',
      type: 'warning'
    });
    await fetch('/api/traffic-logs', { method: 'DELETE' });
    logs.value = [];
    total.value = 0;
    newestId.value = 0;
    newRowIds.value.clear();
    ElMessage.success('日志已清空');
    // 重新确保 WS 订阅和后端录制处于开启状态，避免清空后收不到新日志
    if (autoRefresh.value) {
      subscribeWs();
      await setRecording(true);
    }
  } catch (e) {
    // cancelled
  }
};

// Handle a new log pushed via WS
const handleNewLog = (logEntry) => {
  // Only prepend if on page 1 and no active filters that might exclude it
  const hasFilter = searchQuery.value.target || searchQuery.value.action || searchQuery.value.module ||
                    searchQuery.value.sourceIp || searchQuery.value.status || searchQuery.value.rulePattern;

  if (currentPage.value === 1 && !hasFilter) {
    // Mark as new row for animation
    newRowIds.value.add(logEntry.id);
    // Prepend to the top
    logs.value.unshift(logEntry);
    total.value++;
    // Cap local list to page size to avoid memory bloat
    if (logs.value.length > pageSize.value) {
      logs.value = logs.value.slice(0, pageSize.value);
    }
    newestId.value = logEntry.id;
    // Clean up new-row highlight after 2.5s
    const rid = logEntry.id;
    setTimeout(() => {
      newRowIds.value.delete(rid);
    }, 2500);
  } else {
    // Just bump total so pagination reflects it
    total.value++;
  }
};

const rowClassName = ({ row }) => {
  if (newRowIds.value.has(row.id)) {
    return 'log-new-row';
  }
  return '';
};

const formatBytes = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const moduleLabel = (module) => {
  if (module && module.includes('Proxy')) return '系统代理';
  if (module && module.includes('Forward')) return '虚拟网卡';
  return module || '-';
};

const moduleClass = (module) => {
  if (module && module.includes('Proxy')) return 'module-proxy';
  if (module && module.includes('Forward')) return 'module-forward';
  return 'module-other';
};

const actionLabel = (action) => {
  switch (action) {
    case 'direct_local': return t('logs.direct');
    case 'direct_remote': return t('logs.tunnel');
    case 'proxy_chain': return t('nav.chains');
    case 'block': return t('logs.block');
    default: return action;
  }
};

const actionClass = (action) => {
  switch (action) {
    case 'direct_local': return 'action-direct';
    case 'direct_remote': return 'action-tunnel';
    case 'proxy_chain': return 'action-chain';
    case 'block': return 'action-block';
    default: return 'action-other';
  }
};

const translateNode = (node) => {
  if (node === '本机') return t('logs.local');
  if (node === '直连') return t('logs.direct');
  if (node === '隧道') return t('logs.tunnel');
  if (node === '隧道转发') return t('logs.tunnelFwd');
  if (node === '隧道反向代理') return t('logs.tunnelRev');
  if (node === '拦截') return t('logs.block');
  return node;
};

onMounted(async () => {
  // Sync recording state with default (enabled)
  await setRecording(true);
  await fetchLogs();
  // Subscribe to WS push
  if (onTrafficLog) {
    unsubscribeTrafficLog = onTrafficLog(handleNewLog);
  }
  subscribeWs();
});

onActivated(() => {
  // Page becomes visible again - resubscribe if realtime is on
  if (autoRefresh.value) {
    subscribeWs();
  }
});

onDeactivated(() => {
  // Page hidden (keep-alive) - unsubscribe to save bandwidth
  unsubscribeWs();
});

onUnmounted(() => {
  if (unsubscribeTrafficLog) {
    unsubscribeTrafficLog();
    unsubscribeTrafficLog = null;
  }
  unsubscribeWs();
});

const quickAddDialogVisible = ref(false);
const quickAddHost = ref('');
const selectedCardId = ref('');
const quickAddForm = reactive({
  text: ''
});

const extractHost = (target) => {
  if (!target) return '';
  const idx = target.lastIndexOf(':');
  if (idx !== -1) {
    return target.substring(0, idx);
  }
  return target;
};

const openQuickAddDialog = (target) => {
  quickAddHost.value = extractHost(target);
  if (props.config.ruleCards && props.config.ruleCards.length > 0) {
    selectedCardId.value = props.config.ruleCards[0].id;
    loadCardData();
  } else {
    selectedCardId.value = '';
    quickAddForm.text = '';
  }
  quickAddDialogVisible.value = true;
};

const loadCardData = () => {
  const card = props.config.ruleCards?.find(c => c.id === selectedCardId.value);
  if (card) {
    const patterns = card.patterns ? [...card.patterns] : [];
    if (!patterns.includes(quickAddHost.value)) {
      patterns.push(quickAddHost.value);
    }
    quickAddForm.text = patterns.join('\n');
  }
};

const saveQuickAdd = () => {
  const card = props.config.ruleCards?.find(c => c.id === selectedCardId.value);
  if (card) {
    const patterns = quickAddForm.text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line !== '');
    card.patterns = patterns;
    emit('save');
    quickAddDialogVisible.value = false;
    ElMessage.success(t('logs.quickAddSuccess').replace('{target}', quickAddHost.value).replace('{name}', card.name));
  }
};
</script>

<style scoped>
.traffic-logs-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 110px);
  background: var(--bt-surface);
  border: 1px solid var(--bt-border);
  border-radius: 8px;
  overflow: hidden;
}

.logs-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--bt-border);
  flex-shrink: 0;
}
.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.filter-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 16px;
  background: var(--bt-input-bg);
  border-bottom: 1px solid var(--bt-border);
  overflow-x: auto;
  flex-shrink: 0;
}

.table-wrapper {
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.pagination-bar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding: 8px 16px;
  border-top: 1px solid var(--bt-border);
  background: var(--bt-surface);
  flex-shrink: 0;
}

/* Module text colors (plain text, no badges) */
.module-text {
  font-size: 12px;
  font-weight: 500;
}
.module-proxy {
  color: var(--el-color-primary);
}
.module-forward {
  color: var(--el-color-warning);
}
.module-other {
  color: var(--el-text-color-secondary);
}

/* Action text colors */
.action-text {
  font-size: 12px;
  font-weight: 500;
  cursor: default;
}
.action-direct {
  color: var(--el-color-info);
}
.action-tunnel {
  color: var(--el-color-success);
}
.action-chain {
  color: var(--el-color-warning);
}
.action-block {
  color: var(--el-color-danger);
}
.action-other {
  color: var(--el-text-color-regular);
}

/* Status text colors (plain text, no badges) */
.status-text {
  font-size: 12px;
  font-weight: 600;
}
.status-success {
  color: var(--el-color-success);
}
.status-failed {
  color: var(--el-color-danger);
}

/* New row animation */
:deep(.log-new-row) {
  animation: log-new-flash 2.5s ease-out;
}
@keyframes log-new-flash {
  0% { background-color: rgba(64, 158, 255, 0.25); }
  100% { background-color: transparent; }
}

/* Route path styles */
.route-path-container {
  color: var(--el-text-color-secondary);
}
.route-path-arrow {
  color: var(--el-text-color-placeholder);
}
.route-hop {
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 500;
  font-size: 11px;
  display: inline-block;
}
.route-hop-local {
  background-color: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
}
.route-hop-direct {
  background-color: rgba(103, 194, 58, 0.15);
  color: var(--el-color-success);
}
.route-hop-tunnel {
  background-color: rgba(64, 158, 255, 0.15);
  color: var(--el-color-primary);
}
.route-hop-block {
  background-color: rgba(245, 108, 108, 0.15);
  color: var(--el-color-danger);
}
.route-hop-node {
  background-color: rgba(230, 162, 44, 0.15);
  color: var(--el-color-warning);
  border: 1px solid rgba(230, 162, 44, 0.3);
}
.route-hop-target {
  background-color: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  border: 1px solid var(--el-border-color-light);
  font-family: monospace;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}

/* Ensure table fills width - no empty space */
:deep(.el-table) {
  width: 100% !important;
}
:deep(.el-table__body) {
  width: 100% !important;
}
</style>
