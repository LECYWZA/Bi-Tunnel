<template>
  <div class="space-y-6">
    <div class="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm">
      <div class="flex items-center gap-3">
        <el-icon :size="24" color="#409EFC"><Link /></el-icon>
        <span class="font-bold text-lg">代理链管理 (Proxy Chains)</span>
      </div>
      <el-button type="primary" :icon="Plus" @click="addChain">创建新代理链</el-button>
    </div>

    <el-empty v-if="!config.proxyChains || config.proxyChains.length === 0" description="暂无代理链，请点击右上角创建" :image-size="80" />

    <el-card v-for="(chain, idx) in config.proxyChains" :key="chain.id" shadow="hover" class="mb-6 rounded-xl border-0 bg-white" style="box-shadow: 0 4px 20px rgba(0,0,0,0.05);">
      <template #header>
        <div class="flex justify-between items-center">
          <div class="flex items-center gap-2 flex-1">
            <el-input v-model="chain.name" size="small" class="w-48 font-bold" placeholder="代理链名称" />
            <el-tag size="small" type="info">ID: {{ chain.id.split('_')[1] }}</el-tag>
          </div>
          <div class="flex gap-2">
            <el-button 
              type="primary" 
              plain 
              size="small" 
              :icon="Connection" 
              :loading="testingChain === chain.id"
              @click="testChain(chain.id)"
            >
              {{ testingChain === chain.id ? '测速中...' : '⚡ 测试完整链路' }}
            </el-button>
            <el-popconfirm title="确定要删除整条代理链吗？" @confirm="config.proxyChains.splice(idx, 1)">
              <template #reference>
                <el-button type="danger" size="small" plain :icon="Delete">删除</el-button>
              </template>
            </el-popconfirm>
          </div>
        </div>
      </template>

      <div class="mb-4">
        <div class="flex gap-2">
          <el-select v-model="selectedNodeToAdd" size="small" class="flex-1" placeholder="从节点池中选择一个节点...">
            <el-option v-for="node in config.proxyNodes" :key="node.id" :label="node.displayName" :value="node.id">
              <span class="float-left">{{ node.displayName }}</span>
              <span class="float-right text-gray-400 text-xs">{{ node.type.toUpperCase() }}</span>
            </el-option>
          </el-select>
          <el-button type="success" size="small" :icon="Plus" @click="addNodeToChain(chain)" :disabled="!selectedNodeToAdd">添加到此链</el-button>
        </div>
      </div>

      <el-empty v-if="!chain.nodes || chain.nodes.length === 0" description="链中暂无节点" :image-size="40" />

      <div v-else>
        <div class="text-xs text-gray-400 mb-2 flex items-center gap-1">
          <el-icon><InfoFilled /></el-icon> 支持拖拽调整节点顺序。流量将按从上到下的顺序依次穿透。
        </div>
        
        <draggable v-model="chain.nodes" item-key="id" handle=".drag-handle" animation="300" ghost-class="ghost">
          <template #item="{ element: nodeId, index: nIdx }">
            <div class="flex items-center gap-4 p-4 mb-3 bg-white border border-gray-100 rounded-lg shadow-sm hover:shadow-md transition-all relative group overflow-hidden">
              <div class="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-400 to-indigo-500"></div>
              
              <el-icon class="drag-handle cursor-move text-gray-300 hover:text-indigo-500 transition-colors" :size="24"><Sort /></el-icon>
              
              <div class="flex-1 flex gap-3 items-center">
                <div class="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 font-bold text-sm">
                  {{ nIdx + 1 }}
                </div>
                
                <template v-if="getNode(nodeId)">
                  <el-tag 
                    size="default" 
                    :type="getNode(nodeId).type === 'v2ray' ? 'success' : 'primary'" 
                    effect="dark"
                    class="font-bold tracking-wider"
                    :style="getNode(nodeId).type === 'v2ray' ? 'background: linear-gradient(135deg, #10b981 0%, #059669 100%); border:none;' : 'background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); border:none;'"
                  >
                    {{ getNode(nodeId).type === 'v2ray' ? getNode(nodeId).v2rayType.toUpperCase() : getNode(nodeId).type.toUpperCase() }}
                  </el-tag>
                  <span class="font-bold text-gray-800 text-base">{{ getNode(nodeId).displayName }}</span>
                  <span class="text-xs text-gray-400 font-mono bg-gray-50 px-2 py-1 rounded">id: {{ nodeId.split('_')[1] }}</span>
                </template>
                <template v-else>
                  <span class="text-red-500 italic bg-red-50 px-3 py-1 rounded-full text-sm">⚠️ 节点已丢失 (ID: {{ nodeId }})</span>
                </template>
              </div>

              <el-button type="danger" circle :icon="Delete" @click="chain.nodes.splice(nIdx, 1)" class="opacity-0 group-hover:opacity-100 transition-opacity shadow-sm" />
            </div>
          </template>
        </draggable>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import draggable from 'vuedraggable';
import { Plus, Delete, Link, InfoFilled, Sort, Connection } from '@element-plus/icons-vue';

const props = defineProps({
  config: Object
});

const generateId = () => Math.random().toString(36).substr(2, 9);
const testingChain = ref(null);
const selectedNodeToAdd = ref('');

const addChain = () => {
  if (!props.config.proxyChains) props.config.proxyChains = [];
  props.config.proxyChains.push({
    id: 'chain_' + generateId(),
    name: '新建代理链',
    nodes: []
  });
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

const testChain = async (chainId) => {
  testingChain.value = chainId;
  try {
    const res = await fetch('/api/test-latency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'chain', id: chainId })
    });
    const data = await res.json();
    if (data.success) {
      ElMessage.success(`测试成功! 完整链路延迟: ${data.latency}ms`);
    } else {
      ElMessage.error(`测试失败: ${data.message}`);
    }
  } catch (err) {
    ElMessage.error('请求失败');
  } finally {
    testingChain.value = null;
  }
};
</script>

<style scoped>
.ghost {
  opacity: 0.5;
  background: #c8ebfb;
}
</style>
