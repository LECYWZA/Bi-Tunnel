<template>
  <div class="traffic-logs-container">
    <el-card shadow="hover">
      <template #header>
        <div class="flex flex-col gap-3">
          <div class="flex justify-between items-center">
            <div class="flex items-center gap-2">
              <el-icon class="text-blue-500"><Document /></el-icon>
              <span class="font-bold text-base">实时流量审计</span>
            </div>
            <div class="flex items-center gap-4">
              <span class="text-xs text-gray-500">
                <el-icon class="is-loading mr-1" v-if="autoRefresh"><Loading /></el-icon>
                {{ autoRefresh ? '正在实时刷新' : '自动刷新已暂停' }}
              </span>
              <el-switch v-model="autoRefresh" inline-prompt active-text="实时" inactive-text="暂停" />
              <el-button type="primary" plain size="small" :icon="Refresh" @click="fetchLogs">手动刷新</el-button>
            </div>
          </div>
          
          <div class="flex gap-4 items-center bg-gray-50 p-2 rounded">
            <el-input v-model="searchQuery.target" placeholder="搜索访问目标 (如 google.com)" size="small" class="w-64" clearable @change="fetchLogs" />
            <el-select v-model="searchQuery.action" placeholder="路由策略" size="small" class="w-32" clearable @change="fetchLogs">
              <el-option label="本地直连" value="direct_local" />
              <el-option label="远端直连" value="direct_remote" />
              <el-option label="代理链" value="proxy_chain" />
              <el-option label="拦截" value="block" />
            </el-select>
            <el-select v-model="searchQuery.module" placeholder="模块" size="small" class="w-32" clearable @change="fetchLogs">
              <el-option label="Proxy" value="Proxy" />
              <el-option label="Forward" value="Forward" />
            </el-select>
          </div>
        </div>
      </template>

      <el-table :data="logs" style="width: 100%" v-loading="loading" size="small" border stripe>
        <el-table-column prop="id" label="ID" width="70" align="center" />
        <el-table-column label="时间" width="160">
          <template #default="{ row }">
            {{ new Date(row.timestamp).toLocaleString() }}
          </template>
        </el-table-column>
        <el-table-column prop="module" label="模块" width="180">
          <template #default="{ row }">
            <el-tag size="small" :type="getModuleTagType(row.module)">{{ row.module }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="sourceIp" label="源 IP" width="140" />
        <el-table-column prop="target" label="访问目标" min-width="200">
          <template #default="{ row }">
            <span class="font-mono text-xs">{{ row.target }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="action" label="路由策略" width="120">
          <template #default="{ row }">
            <el-tooltip v-if="row.rulePattern" :content="`命中规则: ${row.rulePattern}`" placement="top">
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
        <el-table-column label="耗时" width="80" align="right">
          <template #default="{ row }">
            {{ row.durationMs }} ms
          </template>
        </el-table-column>
        <el-table-column label="流量" width="100" align="right">
          <template #default="{ row }">
            {{ formatBytes(row.bytesTransferred) }}
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'success' ? 'success' : 'danger'">
              {{ row.status === 'success' ? '成功' : '失败' }}
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
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { Document, Refresh, Loading } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';

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
</script>

<style scoped>
.traffic-logs-container {
  margin-top: 1rem;
}
</style>
