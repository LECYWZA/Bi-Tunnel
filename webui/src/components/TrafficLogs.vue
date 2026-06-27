<template>
  <div class="traffic-logs-container">
    <el-card shadow="hover" class="bt-card">
      <template #header>
        <div class="flex flex-col gap-3">
          <div class="flex justify-between items-center">
            <div class="flex items-center gap-2">
              <el-icon class="text-blue-500"><Document /></el-icon>
              <span class="font-bold text-base">{{ t('logs.title') }}</span>
            </div>
            <div class="flex items-center gap-4">
              <span class="text-xs text-gray-500">
                <el-icon class="is-loading mr-1" v-if="autoRefresh"><Loading /></el-icon>
                {{ autoRefresh ? t('logs.refreshing') : t('logs.paused') }}
              </span>
              <el-switch v-model="autoRefresh" inline-prompt :active-text="t('logs.realtime')" :inactive-text="t('logs.pause')" />
              <el-button type="primary" plain size="small" :icon="Refresh" @click="fetchLogs">{{ t('logs.manualRefresh') }}</el-button>
            </div>
          </div>
          
          <div class="flex gap-4 items-center p-2 rounded" style="background: var(--bt-input-bg); border: 1px solid var(--bt-border);">
            <el-input v-model="searchQuery.target" :placeholder="t('logs.searchTarget')" size="small" class="w-64" clearable @change="fetchLogs" />
            <el-select v-model="searchQuery.action" :placeholder="t('logs.policy')" size="small" class="w-32" clearable @change="fetchLogs">
              <el-option :label="t('logs.direct')" value="direct_local" />
              <el-option :label="t('logs.tunnel')" value="direct_remote" />
              <el-option :label="t('nav.chains')" value="proxy_chain" />
              <el-option :label="t('logs.block')" value="block" />
            </el-select>
            <el-select v-model="searchQuery.module" :placeholder="t('logs.module')" size="small" class="w-32" clearable @change="fetchLogs">
              <el-option label="Proxy" value="Proxy" />
              <el-option label="Forward" value="Forward" />
            </el-select>
          </div>
        </div>
      </template>

      <el-table :data="logs" style="width: 100%" v-loading="loading" size="small" border stripe>
        <el-table-column prop="id" :label="t('logs.id')" width="70" align="center" />
        <el-table-column :label="t('logs.time')" width="160">
          <template #default="{ row }">
            {{ new Date(row.timestamp).toLocaleString() }}
          </template>
        </el-table-column>
        <el-table-column prop="module" :label="t('logs.module')" width="180">
          <template #default="{ row }">
            <el-tag size="small" :type="getModuleTagType(row.module)">{{ row.module }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="sourceIp" label="源 IP" width="140" />
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
        <el-table-column prop="action" :label="t('logs.policy')" width="120">
          <template #default="{ row }">
            <el-tooltip v-if="row.rulePattern" :content="`匹配规则: ${row.rulePattern}`" placement="top">
              <el-tag size="small" effect="plain" :type="getActionTagType(row.action)">{{ row.action }}</el-tag>
            </el-tooltip>
            <el-tag v-else size="small" effect="plain" :type="getActionTagType(row.action)">{{ row.action }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="rulePattern" label="匹配规则" width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="text-xs text-gray-500">{{ row.rulePattern || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('logs.duration')" width="80" align="right">
          <template #default="{ row }">
            {{ row.durationMs }} ms
          </template>
        </el-table-column>
        <el-table-column :label="t('logs.traffic')" width="100" align="right">
          <template #default="{ row }">
            {{ formatBytes(row.bytesTransferred) }}
          </template>
        </el-table-column>
        <el-table-column prop="status" :label="t('logs.status')" width="80" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'success' ? 'success' : 'danger'">
              {{ row.status === 'success' ? t('logs.success') : t('logs.failed') }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>

      <div class="flex justify-end mt-4">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[50, 100, 200, 500]"
          layout="total, sizes, prev, pager, next"
          :total="total"
          @size-change="fetchLogs"
          @current-change="fetchLogs"
        />
      </div>
    </el-card>
    
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
import { ref, reactive, onMounted, onUnmounted, watch } from 'vue';
import { Document, Refresh, Loading, Plus } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { t } from '../i18n';

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

let refreshTimer = null;

const searchQuery = ref({
  target: '',
  action: '',
  module: ''
});

const fetchLogs = async () => {
  if (loading.value) return;
  try {
    const offset = (currentPage.value - 1) * pageSize.value;
    const query = new URLSearchParams({ limit: pageSize.value, offset });
    if (searchQuery.value.target) query.append('target', searchQuery.value.target);
    if (searchQuery.value.action) query.append('action', searchQuery.value.action);
    if (searchQuery.value.module) query.append('module', searchQuery.value.module);

    const res = await fetch(`/api/traffic-logs?${query.toString()}`);
    const data = await res.json();
    logs.value = data.logs;
    total.value = data.total;
  } catch (e) {
    console.error('Failed to fetch logs:', e);
  }
};

const formatBytes = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const getModuleTagType = (module) => {
  if (module.includes('Proxy')) return 'primary';
  if (module.includes('Forward')) return 'warning';
  return 'info';
};

const getActionTagType = (action) => {
  switch (action) {
    case 'direct_local': return 'info';
    case 'direct_remote': return 'success';
    case 'proxy_chain': return 'warning';
    case 'block': return 'danger';
    default: return '';
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

onMounted(() => {
  fetchLogs();
  refreshTimer = setInterval(() => {
    if (autoRefresh.value && currentPage.value === 1) {
      fetchLogs();
    }
  }, 3000);
});

onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
});

watch(autoRefresh, (val) => {
  if (val && currentPage.value === 1) {
    fetchLogs();
  }
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
.traffic-logs-container {
  margin-top: 1rem;
}
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
</style>
