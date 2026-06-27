<template>
  <div class="space-y-6">
    <div class="flex flex-col gap-4 sticky top-[60px] z-10 bg-white dark:bg-gray-900 pb-4 -mx-6 px-6 pt-4 -mt-4">
      <div class="flex justify-between items-center bt-section-status">
        <div class="flex items-center gap-3">
          <el-icon :size="24" style="color: var(--bt-primary)"><Link /></el-icon>
          <span class="font-bold text-lg bt-text">代理链管理 (Proxy Chains)</span>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <div class="flex items-center gap-2">
            <el-input v-model="testTargetLatency" placeholder="测延目标: host:port" class="w-48" size="small" />
            <el-button type="warning" plain :icon="Connection" size="small" @click="testAllLatency" :loading="testingAllLatency">测速全部(延迟)</el-button>
          </div>
          <div class="flex items-center gap-2">
            <el-input v-model="testTargetSpeed" placeholder="测速目标: host:port" class="w-48" size="small" />
            <el-button type="success" plain :icon="Odometer" size="small" @click="testAllSpeed" :loading="testingAllSpeed">测速全部(速度)</el-button>
          </div>
          <el-button type="primary" :icon="Plus" @click="addChain">创建新代理链</el-button>
        </div>
      </div>
    </div>

    <el-empty v-if="!config.proxyChains || config.proxyChains.length === 0" description="暂无代理链，请点击右上角创建" :image-size="80" />

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6" v-else>
      <el-card v-for="(chain, idx) in config.proxyChains" :key="chain.id" shadow="hover" class="bt-card h-full transition-transform hover:-translate-y-1" body-class="flex flex-col h-full">
        <div class="flex justify-between items-center mb-4 pb-3" style="border-bottom: 1px solid var(--bt-border);">
          <div class="font-bold text-lg bt-text truncate flex-1">{{ chain.name }}</div>
          <el-tag size="small" type="info" effect="plain" round>ID: {{ chain.id.split('_')[1] }}</el-tag>
        </div>

        <div class="flex-1 mb-4">
          <el-empty v-if="!chain.nodes || chain.nodes.length === 0" description="空代理链" :image-size="40" />
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
                <span class="text-red-500 text-sm">节点已失效或被删除</span>
              </template>
            </div>
          </div>
        </div>

        <!-- Metrics Section -->
        <div class="flex items-center gap-4 mb-3 text-xs p-2 rounded border" style="border-color: var(--bt-border); background: var(--bt-input-bg);">
          <div class="flex items-center gap-1 flex-1">
            <el-icon :class="getLatencyColor(chain._latency)"><Clock /></el-icon>
            <span class="text-gray-500">延迟:</span>
            <span class="font-bold font-mono" :class="getLatencyColor(chain._latency)">{{ chain._latency ? chain._latency + ' ms' : '--' }}</span>
          </div>
          <div class="flex items-center gap-1 flex-1">
            <el-icon :class="getSpeedColor(chain._speed)"><Odometer /></el-icon>
            <span class="text-gray-500">速度:</span>
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
              :loading="testingChain === chain.id"
              @click="testChain(chain.id)"
            >
              测延迟
            </el-button>
            <el-button 
              type="success" 
              link
              size="small" 
              :icon="Odometer" 
              :loading="testingSpeedChain === chain.id"
              @click="testSpeedChain(chain.id)"
            >
              测速度
            </el-button>
          </div>
          
          <div class="flex gap-2">
            <el-button type="primary" plain :icon="Edit" size="small" @click="openChainEditor(chain)" />
            <el-popconfirm title="确定要删除整条代理链吗？" @confirm="config.proxyChains.splice(idx, 1)">
              <template #reference>
                <el-button type="danger" plain :icon="Delete" size="small" />
              </template>
            </el-popconfirm>
          </div>
        </div>
      </el-card>
    </div>

    <!-- Edit Chain Dialog -->
    <el-dialog v-model="editDialogVisible" :title="`编辑代理链 - ${editingChain?.name || ''}`" width="650px" destroy-on-close>
      <div v-if="editingChain" class="min-h-[300px]">
        <div class="mb-4">
          <el-input v-model="editingChain.name" placeholder="代理链名称">
            <template #prepend>名称</template>
          </el-input>
        </div>

        <div class="mb-4">
          <div class="flex gap-2">
            <el-select v-model="selectedNodeToAdd" class="flex-1" placeholder="从节点池中选择一个节点..." filterable clearable>
              <el-option v-for="node in config.proxyNodes" :key="node.id" :label="node.displayName" :value="node.id">
                <span class="float-left">{{ node.displayName }}</span>
                <span class="float-right text-gray-400 text-xs">{{ node.type.toUpperCase() }}</span>
              </el-option>
            </el-select>
            <el-button type="success" :icon="Plus" @click="addNodeToChain(editingChain)" :disabled="!selectedNodeToAdd">添加节点</el-button>
          </div>
        </div>

        <el-empty v-if="!editingChain.nodes || editingChain.nodes.length === 0" description="链中暂无节点" :image-size="60" />

        <div v-else>
          <div class="text-xs text-gray-400 mb-2 flex items-center gap-1">
            <el-icon><InfoFilled /></el-icon> 支持拖拽调整节点顺序。流量将按从上到下的顺序依次穿透。
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
                    <span class="text-red-500 italic bg-red-50 px-3 py-1 rounded-full text-sm">⚠️ 节点已丢失 (ID: {{ nodeId }})</span>
                  </template>
                </div>

                <el-button type="danger" link :icon="Delete" @click="editingChain.nodes.splice(nIdx, 1)" class="opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </template>
          </draggable>
        </div>
      </div>
      <template #footer>
        <el-button @click="editDialogVisible = false">完成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import draggable from 'vuedraggable';
import { Plus, Delete, Link, InfoFilled, Sort, Connection, Clock, Odometer, Edit } from '@element-plus/icons-vue';

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
    name: '新建代理链',
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

const testChain = async (chainId, silent = false) => {
  testingChain.value = chainId;
  try {
    const parts = testTargetLatency.value.split(':');
    const targetHost = parts[0] || 'www.bing.com';
    const targetPort = parseInt(parts[1]) || 443;

    const res = await fetch('/api/test-latency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'chain', id: chainId, targetHost, targetPort })
    });
    const data = await res.json();
    const chain = props.config.proxyChains.find(c => c.id === chainId);
    
    if (data.success) {
      if (chain) chain._latency = data.latency;
      if (!silent) ElMessage.success(`测试成功! 完整链路延迟: ${data.latency}ms`);
    } else {
      if (chain) chain._latency = null;
      if (!silent) ElMessage.error(`测试失败: ${data.message}`);
    }
  } catch (err) {
    if (!silent) ElMessage.error('请求失败');
  } finally {
    if (testingChain.value === chainId) testingChain.value = null;
  }
};

const testSpeedChain = async (chainId, silent = false) => {
  testingSpeedChain.value = chainId;
  try {
    const parts = testTargetSpeed.value.split(':');
    const targetHost = parts[0] || 'speed.cloudflare.com';
    const targetPort = parseInt(parts[1]) || 443;
    const res = await fetch('/api/test-speed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'chain', id: chainId, targetHost, targetPort })
    });
    const data = await res.json();
    const chain = props.config.proxyChains.find(c => c.id === chainId);
    
    if (data.success) {
      if (chain) chain._speed = data.speed;
      if (!silent) ElMessage.success(`测试成功! 预估速度: ${data.speed} MB/s`);
    } else {
      if (chain) chain._speed = null;
      if (!silent) ElMessage.error(`测试失败: ${data.message}`);
    }
  } catch (err) {
    if (!silent) ElMessage.error('请求失败');
  } finally {
    if (testingSpeedChain.value === chainId) testingSpeedChain.value = null;
  }
};

const testAllLatency = async () => {
  if (!props.config.proxyChains || props.config.proxyChains.length === 0) return;
  testingAllLatency.value = true;
  ElMessage.info('开始全部代理链延迟测试，请稍候...');
  const promises = props.config.proxyChains.map(c => testChain(c.id, true));
  await Promise.allSettled(promises);
  testingAllLatency.value = false;
  ElMessage.success('全部代理链延迟测试完成');
};

const testAllSpeed = async () => {
  if (!props.config.proxyChains || props.config.proxyChains.length === 0) return;
  testingAllSpeed.value = true;
  ElMessage.info('开始全部代理链速度测试，请稍候...');
  const promises = props.config.proxyChains.map(c => testSpeedChain(c.id, true));
  await Promise.allSettled(promises);
  testingAllSpeed.value = false;
  ElMessage.success('全部代理链速度测试完成');
};
</script>

<style scoped>
.ghost {
  opacity: 0.5;
  background: #c8ebfb;
}
</style>
