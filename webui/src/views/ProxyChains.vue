<template>
  <div class="space-y-6">
    <div class="flex flex-col gap-4 sticky top-[60px] z-10 bg-white dark:bg-gray-900 pb-4 -mx-6 px-6 pt-4 -mt-4">
      <div class="flex justify-between items-center bt-section-status">
        <div class="flex items-center gap-3">
          <el-icon :size="24" style="color: var(--bt-primary)"><Link /></el-icon>
          <span class="font-bold text-lg bt-text">{{ t('chains.headerTitle') }}</span>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <div class="flex items-center gap-2 px-2 py-1 rounded" style="background: var(--bt-surface); border: 1px solid var(--bt-border);">
            <span class="text-xs font-bold bt-text-secondary whitespace-nowrap">{{ t('rules.networkMode') }}</span>
            <el-select v-model="testNetworkMode" size="small" style="width: 100px;" @change="(val) => { if (val !== 'remote') testTargetClientId = ''; }">
              <el-option :label="t('rules.networkLocal')" value="local" />
              <el-option :label="t('rules.networkRemote')" value="remote" />
            </el-select>
            <el-select v-if="testNetworkMode === 'remote'" v-model="testTargetClientId" size="small" style="width: 150px;" filterable :placeholder="props.config.mode === 'server' ? t('proxies.targetClientIdPlaceholder') : t('proxies.carrierServerPlaceholder')">
              <template v-if="props.config.mode === 'server'">
                <el-option v-for="c in (props.config.server?.knownClients || [])" :key="c.id" :label="`${c.id}${c.online ? ' (' + t('proxies.clientOnline') + ')' : ''}`" :value="c.id" />
              </template>
              <template v-else>
                <el-option v-for="c in (props.config.client?.connections || [])" :key="c.id" :label="c.alias" :value="c.id" />
              </template>
            </el-select>
          </div>
          <div class="flex items-center gap-2">
            <el-input v-model="testTargetLatency" :placeholder="t('chains.testLatencyTarget')" class="w-48" size="small" />
            <el-button type="warning" plain :icon="Connection" size="small" @click="testAllLatency">{{ testingAllLatency ? t('common.cancel') : t('chains.testAllLatency') }}</el-button>
          </div>
          <div class="flex items-center gap-2">
            <el-input v-model="testTargetSpeed" :placeholder="t('chains.testSpeedTarget')" class="w-48" size="small" />
            <el-button type="success" plain :icon="Odometer" size="small" @click="testAllSpeed">{{ testingAllSpeed ? t('common.cancel') : t('chains.testAllSpeed') }}</el-button>
          </div>
          <el-button type="primary" :icon="Plus" @click="addChain">{{ t('chains.createNew') }}</el-button>
        </div>
      </div>
    </div>

    <el-empty v-if="!config.proxyChains || config.proxyChains.length === 0" :description="t('chains.empty')" :image-size="80" />

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6" v-else>
      <el-card v-for="(chain, idx) in config.proxyChains" :key="chain.id" shadow="hover" class="bt-card h-full transition-transform hover:-translate-y-1" body-class="flex flex-col h-full">
        <div class="flex justify-between items-center mb-4 pb-3" style="border-bottom: 1px solid var(--bt-border);">
          <div class="font-bold text-lg bt-text truncate flex-1">{{ chain.name }}</div>
          <el-tag size="small" type="info" effect="plain" round>ID: {{ chain.id.split('_')[1] }}</el-tag>
        </div>

        <div class="flex-1 mb-4">
          <el-empty v-if="!chain.nodes || chain.nodes.length === 0" :description="t('chains.emptyChain')" :image-size="40" />
          <div v-else class="flex flex-col gap-2">
            <div v-for="(nodeId, nIdx) in chain.nodes" :key="nIdx" class="flex items-center gap-2 p-2 rounded-lg" style="background: var(--bt-input-bg); border: 1px solid var(--bt-border);">
              <div class="flex items-center justify-center w-6 h-6 rounded-full font-bold text-xs" style="background: var(--bt-primary-light); color: var(--bt-primary);">
                {{ nIdx + 1 }}
              </div>
              <template v-if="getNode(nodeId)">
                <el-tag size="small" :type="getNode(nodeId).type === 'v2ray' ? 'success' : 'primary'" effect="dark">
                  {{ getNode(nodeId).type === 'v2ray' ? getNode(nodeId).v2rayType.toUpperCase() : getNode(nodeId).type.toUpperCase() }}
                </el-tag>
                <span class="font-bold bt-text text-sm truncate flex-1">{{ getNode(nodeId).displayName }}</span>
              </template>
              <template v-else>
                <span class="text-red-500 text-sm">{{ t('chains.nodeInvalid') }}</span>
              </template>
            </div>
          </div>
        </div>

        <!-- Metrics Section -->
        <div class="flex items-center gap-4 mb-3 text-xs p-2 rounded border" style="border-color: var(--bt-border); background: var(--bt-input-bg);">
          <div class="flex items-center gap-1 flex-1">
            <el-icon :class="getLatencyColor(chain._latency)"><Clock /></el-icon>
            <span class="text-gray-500">{{ t('chains.latencyLabel') }}:</span>
            <span class="font-bold font-mono" :class="getLatencyColor(chain._latency)">{{ chain._latency ? chain._latency + ' ms' : '--' }}</span>
          </div>
          <div class="flex items-center gap-1 flex-1">
            <el-icon :class="getSpeedColor(chain._speed)"><Odometer /></el-icon>
            <span class="text-gray-500">{{ t('chains.speedLabel') }}:</span>
            <span class="font-bold font-mono" :class="getSpeedColor(chain._speed)">{{ chain._speed ? chain._speed + ' MB/s' : '--' }}</span>
          </div>
        </div>

        <div class="flex justify-between items-center mt-auto pt-3" style="border-top: 1px solid var(--bt-border);">
          <div class="flex gap-2">
            <el-button
              type="primary"
              link
              size="small"
              :icon="Connection"
              @click="testChain(chain.id)"
            >
              {{ testingChain === chain.id ? t('common.cancel') : t('chains.testLatencyBtn') }}
            </el-button>
            <el-button
              type="success"
              link
              size="small"
              :icon="Odometer"
              @click="testSpeedChain(chain.id)"
            >
              {{ testingSpeedChain === chain.id ? t('common.cancel') : t('chains.testSpeedBtn') }}
            </el-button>
          </div>

          <div class="flex gap-2">
            <el-button type="primary" plain :icon="Edit" size="small" @click="openChainEditor(chain)" />
            <el-popconfirm :title="t('chains.deleteChainConfirm')" @confirm="config.proxyChains.splice(idx, 1)">
              <template #reference>
                <el-button type="danger" plain :icon="Delete" size="small" />
              </template>
            </el-popconfirm>
          </div>
        </div>
      </el-card>
    </div>

    <!-- Edit Chain Dialog -->
    <el-dialog v-model="editDialogVisible" :title="t('chains.editDialogTitle', { name: editingChain?.name || '' })" width="650px" destroy-on-close>
      <div v-if="editingChain" class="min-h-[300px]">
        <div class="mb-4">
          <el-input v-model="editingChain.name" :placeholder="t('chains.chainNameInputPlaceholder')">
            <template #prepend>{{ t('chains.nameLabel') }}</template>
          </el-input>
        </div>

        <div class="mb-4">
          <div class="flex gap-2">
            <el-select v-model="selectedNodeToAdd" class="flex-1" :placeholder="t('chains.selectNodeToAdd')" filterable clearable>
              <el-option v-for="node in config.proxyNodes" :key="node.id" :label="node.displayName" :value="node.id">
                <span class="float-left">{{ node.displayName }}</span>
                <span class="float-right text-gray-400 text-xs">{{ node.type.toUpperCase() }}</span>
              </el-option>
            </el-select>
            <el-button type="success" :icon="Plus" @click="addNodeToChain(editingChain)" :disabled="!selectedNodeToAdd">{{ t('chains.addNodeBtn') }}</el-button>
          </div>
        </div>

        <el-empty v-if="!editingChain.nodes || editingChain.nodes.length === 0" :description="t('chains.chainEmpty')" :image-size="60" />

        <div v-else>
          <div class="text-xs text-gray-400 mb-2 flex items-center gap-1">
            <el-icon><InfoFilled /></el-icon> {{ t('chains.dragHint') }}
          </div>

          <draggable v-model="editingChain.nodes" item-key="id" handle=".drag-handle" animation="300" ghost-class="ghost">
            <template #item="{ element: nodeId, index: nIdx }">
              <div class="flex items-center gap-4 p-3 mb-2 rounded-lg relative group transition-all" style="background: var(--bt-surface); border: 1px solid var(--bt-border);">
                <el-icon class="drag-handle cursor-move transition-colors" style="color: var(--bt-text-muted);" :size="24"><Sort /></el-icon>

                <div class="flex-1 flex gap-3 items-center">
                  <div class="flex items-center justify-center w-8 h-8 rounded-full font-bold text-sm" style="background: var(--bt-primary-light); color: var(--bt-primary);">
                    {{ nIdx + 1 }}
                  </div>

                  <template v-if="getNode(nodeId)">
                    <el-tag
                      size="small"
                      :type="getNode(nodeId).type === 'v2ray' ? 'success' : 'primary'"
                      effect="dark"
                    >
                      {{ getNode(nodeId).type === 'v2ray' ? getNode(nodeId).v2rayType.toUpperCase() : getNode(nodeId).type.toUpperCase() }}
                    </el-tag>
                    <span class="font-bold bt-text text-base">{{ getNode(nodeId).displayName }}</span>
                  </template>
                  <template v-else>
                    <span class="text-red-500 italic bg-red-50 px-3 py-1 rounded-full text-sm">{{ t('chains.nodeLost', { id: nodeId }) }}</span>
                  </template>
                </div>

                <el-button type="danger" link :icon="Delete" @click="editingChain.nodes.splice(nIdx, 1)" class="opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </template>
          </draggable>
        </div>
      </div>
      <template #footer>
        <el-button @click="editDialogVisible = false">{{ t('chains.done') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import draggable from 'vuedraggable';
import { Plus, Delete, Link, InfoFilled, Sort, Connection, Clock, Odometer, Edit } from '@element-plus/icons-vue';
import { t } from '../i18n';

const props = defineProps({
  config: Object
});

const generateId = () => Math.random().toString(36).substr(2, 9);
const testingChain = ref(null);
const testingSpeedChain = ref(null);
const testingAllLatency = ref(false);
const testingAllSpeed = ref(false);
const selectedNodeToAdd = ref('');
const testTargetLatency = ref('www.bing.com:443');
const testTargetSpeed = ref('speed.cloudflare.com:443');
// 测速/测延迟公共网络出口
const testNetworkMode = ref('local');
const testTargetClientId = ref('');

const getLatencyColor = (latency) => {
  if (!latency) return 'text-gray-400';
  if (latency < 200) return 'text-green-500';
  if (latency < 1000) return 'text-yellow-500';
  return 'text-red-500';
};

const getSpeedColor = (speed) => {
  if (!speed) return 'text-gray-400';
  if (speed > 5) return 'text-green-500';
  if (speed > 1) return 'text-yellow-500';
  return 'text-red-500';
};

const addChain = () => {
  if (!props.config.proxyChains) props.config.proxyChains = [];
  const newChain = {
    id: 'chain_' + generateId(),
    name: t('chains.newChainDefaultName'),
    nodes: []
  };
  props.config.proxyChains.push(newChain);
  openChainEditor(newChain);
};

const editDialogVisible = ref(false);
const editingChain = ref(null);

const openChainEditor = (chain) => {
  editingChain.value = chain;
  editDialogVisible.value = true;
};

const getNode = (nodeId) => {
  return props.config.proxyNodes?.find(n => n.id === nodeId);
};

const addNodeToChain = (chain) => {
  if (!selectedNodeToAdd.value) return;
  if (!chain.nodes) chain.nodes = [];
  chain.nodes.push(selectedNodeToAdd.value);
  selectedNodeToAdd.value = ''; // reset
};

// 用于支持"再次点击取消"的 AbortController 映射
const abortControllers = ref({});

const testChain = async (chainId, silent = false) => {
  const key = `latency:${chainId}`;
  if (testingChain.value === chainId) {
    const ac = abortControllers.value[key];
    if (ac) { ac.abort(); delete abortControllers.value[key]; }
    testingChain.value = null;
    if (!silent) ElMessage.info(t('chains.latencyCanceled'));
    return;
  }
  testingChain.value = chainId;
  const controller = new AbortController();
  abortControllers.value[key] = controller;
  try {
    const parts = testTargetLatency.value.split(':');
    const targetHost = parts[0] || 'www.bing.com';
    const targetPort = parseInt(parts[1]) || 443;

    const res = await fetch('/api/test-latency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'chain', id: chainId, targetHost, targetPort, networkMode: testNetworkMode.value, targetClientId: testTargetClientId.value }),
      signal: controller.signal
    });
    const data = await res.json();
    const chain = props.config.proxyChains.find(c => c.id === chainId);

    if (data.success) {
      if (chain) chain._latency = data.latency;
      if (!silent) ElMessage.success(t('chains.testLatencySuccess', { latency: data.latency }));
    } else {
      if (chain) chain._latency = null;
      if (!silent) ElMessage.error(t('chains.testLatencyFailed', { msg: data.message }));
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      if (!silent) ElMessage.info(t('chains.latencyCanceled'));
    } else {
      if (!silent) ElMessage.error(t('chains.requestFailed'));
    }
  } finally {
    if (testingChain.value === chainId) testingChain.value = null;
    delete abortControllers.value[key];
  }
};

const testSpeedChain = async (chainId, silent = false) => {
  const key = `speed:${chainId}`;
  if (testingSpeedChain.value === chainId) {
    const ac = abortControllers.value[key];
    if (ac) { ac.abort(); delete abortControllers.value[key]; }
    testingSpeedChain.value = null;
    if (!silent) ElMessage.info(t('chains.speedCanceled'));
    return;
  }
  testingSpeedChain.value = chainId;
  const controller = new AbortController();
  abortControllers.value[key] = controller;
  try {
    const parts = testTargetSpeed.value.split(':');
    const targetHost = parts[0] || 'speed.cloudflare.com';
    const targetPort = parseInt(parts[1]) || 443;
    const res = await fetch('/api/test-speed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'chain', id: chainId, targetHost, targetPort, networkMode: testNetworkMode.value, targetClientId: testTargetClientId.value }),
      signal: controller.signal
    });
    const data = await res.json();
    const chain = props.config.proxyChains.find(c => c.id === chainId);

    if (data.success) {
      if (chain) chain._speed = data.speed;
      if (!silent) ElMessage.success(t('chains.testSpeedSuccess', { speed: data.speed }));
    } else {
      if (chain) chain._speed = null;
      if (!silent) ElMessage.error(t('chains.testSpeedFailed', { msg: data.message }));
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      if (!silent) ElMessage.info(t('chains.speedCanceled'));
    } else {
      if (!silent) ElMessage.error(t('chains.requestFailed'));
    }
  } finally {
    if (testingSpeedChain.value === chainId) testingSpeedChain.value = null;
    delete abortControllers.value[key];
  }
};

const testAllLatency = async () => {
  if (testingAllLatency.value) {
    Object.keys(abortControllers.value).forEach(k => {
      if (k.startsWith('latency:')) {
        abortControllers.value[k].abort();
        delete abortControllers.value[k];
      }
    });
    testingAllLatency.value = false;
    testingChain.value = null;
    ElMessage.info(t('chains.cancelAllLatency'));
    return;
  }
  if (!props.config.proxyChains || props.config.proxyChains.length === 0) return;
  testingAllLatency.value = true;
  ElMessage.info(t('chains.startAllLatency'));
  const promises = props.config.proxyChains.map(c => testChain(c.id, true));
  await Promise.allSettled(promises);
  if (testingAllLatency.value) {
    testingAllLatency.value = false;
    ElMessage.success(t('chains.allLatencyComplete'));
  }
};

const testAllSpeed = async () => {
  if (testingAllSpeed.value) {
    Object.keys(abortControllers.value).forEach(k => {
      if (k.startsWith('speed:')) {
        abortControllers.value[k].abort();
        delete abortControllers.value[k];
      }
    });
    testingAllSpeed.value = false;
    testingSpeedChain.value = null;
    ElMessage.info(t('chains.cancelAllSpeed'));
    return;
  }
  if (!props.config.proxyChains || props.config.proxyChains.length === 0) return;
  testingAllSpeed.value = true;
  ElMessage.info(t('chains.startAllSpeed'));
  const promises = props.config.proxyChains.map(c => testSpeedChain(c.id, true));
  await Promise.allSettled(promises);
  if (testingAllSpeed.value) {
    testingAllSpeed.value = false;
    ElMessage.success(t('chains.allSpeedComplete'));
  }
};
</script>

<style scoped>
.ghost {
  opacity: 0.5;
  background: #c8ebfb;
}
</style>
