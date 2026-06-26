<template>
  <div class="space-y-6">
    <div class="flex justify-between items-center bt-section-status">
      <div class="flex items-center gap-3">
        <el-icon :size="24" style="color: var(--bt-primary)"><Monitor /></el-icon>
        <span class="font-bold text-lg bt-text">代理节点池 (Global Proxy Nodes)</span>
      </div>
      <el-button type="primary" :icon="Plus" @click="openImportDialog">添加/导入节点</el-button>
    </div>

    <el-empty v-if="!config.proxyNodes || config.proxyNodes.length === 0" description="暂无代理节点，请点击右上角添加" :image-size="80" />

    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4" v-else>
      <el-card v-for="(node, idx) in config.proxyNodes" :key="node.id" shadow="hover" body-class="flex flex-col h-full" class="bt-card h-full">
        
        <!-- Header Section -->
        <div class="flex justify-between items-center mb-4">
          <div class="flex items-center gap-2 flex-1 overflow-hidden">
            <el-tag 
              size="small" 
              :type="node.type === 'v2ray' ? 'success' : 'primary'" 
              effect="dark"
            >
              {{ node.type === 'v2ray' ? node.v2rayType.toUpperCase() : node.type.toUpperCase() }}
            </el-tag>
            <span class="font-bold text-base truncate flex-1">{{ node.displayName }}</span>
          </div>
          
          <div class="flex items-center gap-2">
            <el-button v-if="node.type === 'v2ray'" type="primary" plain :icon="Edit" size="small" @click="openV2rayEditor(node)" />
            <el-popconfirm title="确定要删除此节点吗？" @confirm="deleteNode(idx, node.id)">
              <template #reference>
                <el-button type="danger" plain :icon="Delete" size="small" />
              </template>
            </el-popconfirm>
          </div>
        </div>

        <!-- Details Section -->
        <div class="mb-4 flex-1">
          <template v-if="node.type === 'v2ray'">
            <div class="flex items-center gap-2 mb-2 text-sm">
              <span class="text-gray-500 w-12">URL:</span>
              <el-tooltip :content="node.rawUrl" placement="top">
                <span class="font-mono text-gray-600 truncate flex-1 cursor-pointer">********</span>
              </el-tooltip>
            </div>
            <div class="flex items-center gap-2 text-sm">
              <span class="text-gray-500 w-12">状态:</span>
              <el-tag size="small" type="success" effect="plain"><el-icon class="mr-1"><Check /></el-icon>解析成功</el-tag>
            </div>
          </template>

          <template v-else>
            <div class="flex items-center gap-2 mb-2">
              <span class="text-gray-500 text-sm w-12">地址:</span>
              <el-input v-model="node.host" size="small" class="flex-1" placeholder="IP/域名" />
              <span class="text-gray-400">:</span>
              <el-input-number v-model="node.port" size="small" :min="1" :max="65535" :controls="false" class="w-20" placeholder="端口" />
            </div>
            <div class="flex items-center gap-2">
              <span class="text-gray-500 text-sm w-12">认证:</span>
              <el-input v-model="node.user" size="small" placeholder="用户名" class="flex-1" />
              <el-input v-model="node.pass" size="small" placeholder="密码" show-password class="flex-1" />
            </div>
          </template>
        </div>

        <!-- Footer Section -->
        <div class="flex justify-between items-center pt-2 mt-2">
          <div class="text-xs text-gray-400 font-mono">ID: {{ node.id.split('_')[1] }}</div>
          <el-button 
            type="primary" 
            :plain="testingNode !== node.id" 
            size="small" 
            :icon="Connection" 
            :loading="testingNode === node.id"
            @click="testLatency(node.id)"
          >
            {{ testingNode === node.id ? '测速中...' : '⚡ 测试延迟' }}
          </el-button>
        </div>
      </el-card>
    </div>

    <!-- Import / Add Node Dialog -->
    <el-dialog v-model="importDialogVisible" title="添加/导入节点" width="600px" destroy-on-close>
      <el-tabs v-model="importTab" class="mt-[-10px]">
        <el-tab-pane label="纯文本/剪贴板批量导入" name="text">
          <div class="mb-2 text-sm text-gray-500">
            支持粘贴 vmess://, vless://, trojan://, ss://, http://, socks5:// 格式链接。每行一个。
          </div>
          <el-input v-model="importText" type="textarea" :rows="8" placeholder="在此粘贴链接..." />
          <div class="mt-4 flex justify-between">
            <el-button @click="readClipboard" :icon="DocumentCopy">从剪贴板读取</el-button>
            <el-button type="primary" @click="doImportText" :icon="Check">解析并导入</el-button>
          </div>
        </el-tab-pane>
        <el-tab-pane label="手动添加基础节点" name="manual">
          <el-form label-width="80px">
            <el-form-item label="名称">
              <el-input v-model="manualForm.displayName" placeholder="例如: 本地SOCKS5" />
            </el-form-item>
            <el-form-item label="协议类型">
              <el-radio-group v-model="manualForm.type">
                <el-radio-button label="socks5">SOCKS5</el-radio-button>
                <el-radio-button label="http">HTTP</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="服务器">
              <el-input v-model="manualForm.host" placeholder="例如: 192.168.1.100" />
            </el-form-item>
            <el-form-item label="端口">
              <el-input-number v-model="manualForm.port" :min="1" :max="65535" class="w-full" />
            </el-form-item>
            <el-form-item label="用户名">
              <el-input v-model="manualForm.user" placeholder="可选" />
            </el-form-item>
            <el-form-item label="密码">
              <el-input v-model="manualForm.pass" type="password" show-password placeholder="可选" />
            </el-form-item>
          </el-form>
          <div class="flex justify-end mt-4">
            <el-button type="primary" @click="doAddManual" :icon="Check">添加到节点池</el-button>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-dialog>

    <!-- V2Ray Edit Dialog -->
    <el-dialog v-model="v2rayEditDialogVisible" title="编辑 V2Ray 节点参数" width="550px" destroy-on-close>
      <el-form label-width="100px" size="small">
        <div class="font-bold text-gray-700 mb-2 pb-1" style="border-bottom: 1px solid #e4e7ed;">基础连接</div>
        <el-form-item label="节点名称">
          <el-input v-model="v2rayEditForm.displayName" />
        </el-form-item>
        <el-form-item label="主机/IP (Host)">
          <el-input v-model="v2rayEditForm.host" />
        </el-form-item>
        <el-form-item label="端口 (Port)">
          <el-input-number v-model="v2rayEditForm.port" :min="1" :max="65535" class="w-full" />
        </el-form-item>
        <el-form-item label="用户ID (UUID)">
          <el-input v-model="v2rayEditForm.uuid" show-password />
        </el-form-item>

        <div class="font-bold text-gray-700 mb-2 mt-4 pb-1" style="border-bottom: 1px solid #e4e7ed;">传输与安全</div>
        <el-form-item label="网络协议">
          <el-select v-model="v2rayEditForm.network" class="w-full">
            <el-option label="TCP" value="tcp" />
            <el-option label="WebSocket (WS)" value="ws" />
            <el-option label="gRPC" value="grpc" />
          </el-select>
        </el-form-item>
        <el-form-item label="路径 (Path)" v-if="v2rayEditForm.network !== 'tcp'">
          <el-input v-model="v2rayEditForm.path" placeholder="例如: /v2ray" />
        </el-form-item>
        <el-form-item label="安全配置">
          <el-select v-model="v2rayEditForm.tls" class="w-full">
            <el-option label="无 (None)" value="none" />
            <el-option label="TLS" value="tls" />
            <el-option label="Reality" value="reality" />
          </el-select>
        </el-form-item>
        <el-form-item label="SNI" v-if="v2rayEditForm.tls !== 'none'">
          <el-input v-model="v2rayEditForm.sni" placeholder="例如: bing.com" />
        </el-form-item>
      </el-form>
      <div class="flex justify-end mt-4">
        <el-button @click="v2rayEditDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveV2rayEditor">保存并更新链接</el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Plus, Delete, Monitor, Connection, DocumentCopy, Check, Edit } from '@element-plus/icons-vue';
import { parseProxyUrl, decodeV2RayUrl, encodeV2RayUrl } from '../utils/v2rayParser';

const props = defineProps({
  config: Object
});

const generateId = () => Math.random().toString(36).substr(2, 9);

const importDialogVisible = ref(false);
const importTab = ref('text');
const importText = ref('');
const manualForm = ref({ displayName: '自建节点', type: 'socks5', host: '', port: 1080, user: '', pass: '' });
const testingNode = ref(null);

const v2rayEditDialogVisible = ref(false);
const v2rayEditForm = ref({});
const v2rayEditingNodeId = ref(null);

const openV2rayEditor = (node) => {
  const decoded = decodeV2RayUrl(node.rawUrl);
  if (!decoded) {
    ElMessage.error('无法解析此 V2Ray 节点参数');
    return;
  }
  v2rayEditForm.value = { ...decoded, displayName: node.displayName };
  v2rayEditingNodeId.value = node.id;
  v2rayEditDialogVisible.value = true;
};

const saveV2rayEditor = () => {
  const node = props.config.proxyNodes.find(n => n.id === v2rayEditingNodeId.value);
  if (!node) return;
  
  const newUrl = encodeV2RayUrl(v2rayEditForm.value);
  if (!newUrl) {
    ElMessage.error('生成节点链接失败，请检查参数是否正确');
    return;
  }
  
  node.rawUrl = newUrl;
  node.displayName = v2rayEditForm.value.displayName;
  // Also parse it back to get basic info in sync
  const basicInfo = parseProxyUrl(newUrl);
  if (basicInfo) {
    node.host = basicInfo.host;
    node.port = basicInfo.port;
  }
  
  ElMessage.success('节点参数已更新');
  v2rayEditDialogVisible.value = false;
};

const openImportDialog = () => {
  importText.value = '';
  manualForm.value = { displayName: '自建节点', type: 'socks5', host: '', port: 1080, user: '', pass: '' };
  importTab.value = 'text';
  importDialogVisible.value = true;
};

const deleteNode = (idx, nodeId) => {
  props.config.proxyNodes.splice(idx, 1);
  // Also remove from chains
  if (props.config.proxyChains) {
    props.config.proxyChains.forEach(chain => {
      if (chain.nodes) {
        chain.nodes = chain.nodes.filter(id => id !== nodeId);
      }
    });
  }
};

const testLatency = async (nodeId) => {
  testingNode.value = nodeId;
  try {
    const res = await fetch('/api/test-latency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'node', id: nodeId })
    });
    const data = await res.json();
    if (data.success) {
      ElMessage.success(`测试成功! 延迟: ${data.latency}ms`);
    } else {
      ElMessage.error(`测试失败: ${data.message}`);
    }
  } catch (err) {
    ElMessage.error('请求失败');
  } finally {
    testingNode.value = null;
  }
};

const readClipboard = async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      importText.value = text;
      ElMessage.success('已读取剪贴板');
    } else {
      ElMessage.warning('剪贴板为空');
    }
  } catch (err) {
    ElMessage.error('无法读取剪贴板，请手动粘贴');
  }
};

const doImportText = () => {
  const urls = importText.value.split('\n').map(s => s.trim()).filter(s => s);
  let imported = 0;
  
  if (!props.config.proxyNodes) props.config.proxyNodes = [];
  
  for (const url of urls) {
    const parsed = parseProxyUrl(url);
    if (parsed) {
      const nodeId = 'node_' + generateId();
      if (parsed.type === 'v2ray') {
        props.config.proxyNodes.push({
          id: nodeId,
          displayName: parsed.displayName || 'V2Ray Node',
          type: 'v2ray',
          v2rayType: parsed.v2rayType,
          rawUrl: parsed.rawUrl
        });
        imported++;
      } else {
        props.config.proxyNodes.push({
          id: nodeId,
          displayName: `${parsed.type.toUpperCase()} Node`,
          type: parsed.type,
          host: parsed.host,
          port: parsed.port,
          user: parsed.user,
          pass: parsed.pass
        });
        imported++;
      }
    }
  }
  
  if (imported > 0) {
    ElMessage.success(`成功导入 ${imported} 个节点`);
    importDialogVisible.value = false;
  } else {
    ElMessage.warning('未解析到有效链接');
  }
};

const doAddManual = () => {
  if (!manualForm.value.host || !manualForm.value.port) {
    ElMessage.warning('请填写主机和端口');
    return;
  }
  if (!props.config.proxyNodes) props.config.proxyNodes = [];
  props.config.proxyNodes.push({
    id: 'node_' + generateId(),
    ...manualForm.value
  });
  ElMessage.success('节点已添加');
  importDialogVisible.value = false;
};
</script>

<style scoped>
</style>
