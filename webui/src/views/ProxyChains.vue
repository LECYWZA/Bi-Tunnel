<template>
  <div class="space-y-6">
    <div class="flex justify-between items-center bt-section-status">
      <div class="flex items-center gap-3">
        <el-icon :size="24" style="color: var(--bt-primary)"><Link /></el-icon>
        <span class="font-bold text-lg bt-text">代理链管理 (Proxy Chains)</span>
      </div>
      <el-button type="primary" :icon="Plus" @click="addChain">创建新代理链</el-button>
    </div>

    <el-empty v-if="!config.proxyChains || config.proxyChains.length === 0" description="暂无代理链，请点击右上角创建" :image-size="80" />

    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" v-else>
      <el-card v-for="(chain, idx) in config.proxyChains" :key="chain.id" shadow="hover" class="h-full" body-class="flex flex-col h-full">
        <div class="flex justify-between items-center mb-2 pb-2" style="border-bottom: 1px solid #e4e7ed;">
          <div class="font-bold truncate flex-1">{{ chain.name }}</div>
          <el-tag size="small" type="info">ID: {{ chain.id.split('_')[1] }}</el-tag>
        </div>

        <div class="text-sm text-gray-500 mb-4 flex-1">
          包含节点数: <span class="font-bold text-gray-800">{{ chain.nodes ? chain.nodes.length : 0 }}</span>
        </div>

        <div class="flex justify-between items-center mt-auto pt-2" style="border-top: 1px solid #e4e7ed;">
          <el-button 
            type="primary" 
            :plain="testingChain !== chain.id" 
            size="small" 
            :icon="Connection" 
            :loading="testingChain === chain.id"
            @click="testChain(chain.id)"
          >
            {{ testingChain === chain.id ? '测速...' : '测速' }}
          </el-button>
          
          <div class="flex gap-2">
            <el-button type="primary" plain :icon="Edit" size="small" @click="openChainEditor(chain)">编辑</el-button>
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
            <el-select v-model="selectedNodeToAdd" class="flex-1" placeholder="从节点池中选择一个节点...">
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
              <div class="flex items-center gap-4 p-3 mb-2 bg-gray-50 rounded-md relative group" style="border: 1px solid #e4e7ed;">
                <el-icon class="drag-handle cursor-move text-gray-300 hover:text-indigo-500 transition-colors" :size="24"><Sort /></el-icon>
                
                <div class="flex-1 flex gap-3 items-center">
                  <div class="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 font-bold text-sm">
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
                    <span class="font-bold text-gray-800 text-base">{{ getNode(nodeId).displayName }}</span>
                    <span class="text-xs text-gray-400 font-mono bg-white border px-2 py-1 rounded" style="border-color: #e4e7ed;">id: {{ nodeId.split('_')[1] }}</span>
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
import { Plus, Delete, Link, InfoFilled, Sort, Connection } from '@element-plus/icons-vue';

const props = defineProps({
  config: Object
});

const generateId = () => Math.random().toString(36).substr(2, 9);
const testingChain = ref(null);
const selectedNodeToAdd = ref('');

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
