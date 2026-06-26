<template>
  <div class="space-y-6">
    <div class="flex flex-col gap-4">
      <div class="flex justify-between items-center bt-section-status">
        <div class="flex items-center gap-3">
          <el-icon :size="24" style="color: var(--bt-primary)"><Monitor /></el-icon>
          <span class="font-bold text-lg bt-text">代理节点池 (Global Proxy Nodes)</span>
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
          <el-button type="primary" plain :icon="Plus" @click="createGroup" size="small">新建分组</el-button>
          <el-button type="danger" plain :icon="Delete" size="small" @click="openCleanDialog">清理失效节点</el-button>
          <el-button type="primary" :icon="Plus" @click="openImportDialog">添加/导入节点</el-button>
        </div>
      </div>
      
      <div class="flex justify-between items-center bg-gray-50/5 p-3 rounded-lg border border-gray-100 dark:border-gray-800">
        <div class="flex items-center gap-4 flex-1">
          <el-input v-model="searchQuery" placeholder="搜索节点名称 / Host" :prefix-icon="Search" class="w-64" clearable />
        </div>
        <div class="text-sm text-gray-500 font-medium">共 {{ config.proxyNodes?.length || 0 }} 个节点</div>
      </div>
    </div>

    <el-empty v-if="Object.keys(groupedNodes).length === 0" description="暂无代理节点，请点击右上角添加" :image-size="80" />

    <div v-else>
      <div v-for="(groupNodes, groupName) in groupedNodes" :key="groupName" class="mb-8">
        <div class="flex items-center gap-2 mb-4 border-b pb-2 cursor-pointer select-none transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 rounded p-2" style="border-color: var(--bt-border);" @click="toggleGroup(groupName)">
          <el-icon class="text-blue-500">
            <FolderOpened v-if="!collapsedGroups[groupName]" />
            <Folder v-else />
          </el-icon>
          <span class="font-bold text-base bt-text flex-1">{{ groupName }}</span>
          <el-tag size="small" type="info" round>{{ groupNodes.length }}</el-tag>
          <el-icon class="text-gray-400">
            <ArrowDown v-if="!collapsedGroups[groupName]" />
            <ArrowRight v-else />
          </el-icon>
        </div>
        
        <div v-show="!collapsedGroups[groupName]" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6">
          <el-card v-for="node in groupNodes" :key="node.id" shadow="hover" body-class="flex flex-col h-full" class="bt-card h-full transition-transform hover:-translate-y-1">
            
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
                <span class="font-bold text-base truncate flex-1" :title="node.displayName">{{ node.displayName }}</span>
              </div>
              
              <div class="flex items-center gap-2">
                <el-button type="info" plain :icon="Share" size="small" @click="openShareDialog(node)" />
                <el-button v-if="node.type === 'v2ray'" type="primary" plain :icon="Edit" size="small" @click="openV2rayEditor(node)" />
                <el-popconfirm title="确定要删除此节点吗？" @confirm="deleteNode(node.id)">
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
                  <span class="font-mono text-gray-600 truncate flex-1">********</span>
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

            <!-- Metrics Section -->
            <div class="flex items-center gap-4 mb-3 text-xs bg-gray-100/50 dark:bg-gray-800/30 p-2 rounded">
              <div class="flex items-center gap-1 flex-1">
                <el-icon :class="getLatencyColor(node._latency)"><Clock /></el-icon>
                <span class="text-gray-500">延迟:</span>
                <span class="font-bold font-mono" :class="getLatencyColor(node._latency)">{{ node._latency ? node._latency + ' ms' : '--' }}</span>
              </div>
              <div class="flex items-center gap-1 flex-1">
                <el-icon :class="getSpeedColor(node._speed)"><Odometer /></el-icon>
                <span class="text-gray-500">速度:</span>
                <span class="font-bold font-mono" :class="getSpeedColor(node._speed)">{{ node._speed ? node._speed + ' MB/s' : '--' }}</span>
              </div>
            </div>

            <!-- Footer Section -->
            <div class="flex justify-between items-center pt-2 border-t" style="border-color: var(--bt-border);">
              <div class="text-xs text-gray-400 font-mono">ID: {{ node.id.split('_')[1] }}</div>
              <div class="flex gap-2">
                <el-button 
                  type="primary" 
                  link
                  size="small" 
                  :icon="Connection" 
                  :loading="testingNode === node.id"
                  @click="testLatency(node.id)"
                >
                  测延迟
                </el-button>
                <el-button 
                  type="success" 
                  link
                  size="small" 
                  :icon="Odometer" 
                  :loading="testingSpeedNode === node.id"
                  @click="testSpeed(node.id)"
                >
                  测速度
                </el-button>
              </div>
            </div>
          </el-card>
        </div>
      </div>
    </div>

    <!-- Share Dialog -->
    <el-dialog v-model="shareDialogVisible" title="分享节点" width="400px" center destroy-on-close>
      <div class="flex flex-col items-center justify-center gap-4 p-4">
        <h3 class="font-bold text-lg text-center">{{ shareNode?.displayName }}</h3>
        <div class="p-2 bg-white rounded-lg shadow-sm border border-gray-100">
          <QrcodeVue v-if="shareNodeUrl" :value="shareNodeUrl" :size="200" level="M" />
        </div>
        <el-button type="primary" @click="copyNodeLink" :icon="DocumentCopy" class="mt-4 w-full">复制节点链接</el-button>
      </div>
    </el-dialog>

    <!-- Import / Add Node Dialog -->
    <el-dialog v-model="importDialogVisible" title="添加/导入节点" width="50%" destroy-on-close>
      <el-tabs v-model="importTab" class="mt-[-10px]">
        <el-tab-pane label="纯文本批量导入" name="text">
          <div class="mb-2 text-sm text-gray-500">
            支持粘贴 vmess://, vless://, trojan://, ss://, http://, socks5:// 格式链接。每行一个。
          </div>
          <el-input v-model="importText" type="textarea" :rows="8" placeholder="在此粘贴链接..." />
          <div class="mt-4 flex justify-between">
            <el-button @click="readClipboard" :icon="DocumentCopy">从剪贴板读取</el-button>
            <el-button type="primary" @click="doImportText" :icon="Check">解析并导入</el-button>
          </div>
        </el-tab-pane>
        
        <el-tab-pane label="扫码导入图片" name="qr">
          <div class="flex flex-col items-center justify-center py-8 gap-4 border-2 border-dashed rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <el-icon class="text-gray-400" :size="48"><FullScreen /></el-icon>
            <div class="text-sm text-gray-500">选择一张包含节点二维码的图片进行解析</div>
            <input type="file" accept="image/*" class="hidden" ref="fileInput" @change="handleQRUpload" />
            <el-button type="primary" @click="$refs.fileInput.click()">选择图片 / 拍照</el-button>
          </div>
          <div v-if="qrResult" class="mt-4 p-3 bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-md border border-green-200 dark:border-green-800 text-sm">
            <div class="font-bold mb-1">识别成功，已自动填入批量导入框：</div>
            <div class="truncate opacity-75 font-mono">{{ qrResult }}</div>
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
            <el-form-item label="分组">
              <el-select v-model="manualForm.group" allow-create filterable default-first-option placeholder="选择或输入分组 (例如: default)" class="w-full">
                <el-option v-for="g in allGroups" :key="g" :label="g" :value="g" />
              </el-select>
            </el-form-item>
          </el-form>
          <div class="flex justify-end mt-4">
            <el-button type="primary" @click="doAddManual" :icon="Check">添加到节点池</el-button>
          </div>
        </el-tab-pane>

        <el-tab-pane label="订阅链接导入" name="sub">
          <div class="mb-4 text-sm text-gray-500">
            输入订阅链接 (Base64) 获取节点。支持多条链接，每行一条。可以设置这批节点的分组和名称标签。
          </div>
          <el-form label-width="80px" class="mb-4 bg-gray-50 dark:bg-gray-800 p-4 rounded-md">
            <el-form-item label="订阅链接" class="mb-3">
              <el-input v-model="subUrl" type="textarea" :rows="3" placeholder="https://... (支持多行)" />
            </el-form-item>
            <div class="grid grid-cols-2 gap-4">
              <el-form-item label="配置名称" class="mb-0">
                <el-input v-model="subName" placeholder="例如: 机场A" size="small" />
              </el-form-item>
              <el-form-item label="归属分组" class="mb-0">
                <el-select v-model="subGroup" allow-create filterable default-first-option placeholder="默认为 default" class="w-full" size="small">
                  <el-option v-for="g in allGroups" :key="g" :label="g" :value="g" />
                </el-select>
              </el-form-item>
            </div>
          </el-form>
          <div class="flex justify-end mb-4">
            <el-button type="primary" :loading="fetchingSub" @click="fetchSubscription" class="w-32">获取节点</el-button>
          </div>
          <div v-if="subNodes.length > 0" class="border rounded-md p-2 h-64 overflow-y-auto mb-4" style="background: var(--bt-surface); border-color: var(--bt-border);">
            <el-checkbox-group v-model="selectedSubNodes">
              <div v-for="(node, idx) in subNodes" :key="idx" class="mb-2 last:mb-0">
                <el-checkbox :label="node">
                  <span class="font-bold mr-2">{{ node.displayName }}</span>
                  <span class="text-xs text-gray-500">{{ node.type }} - {{ node.host }}:{{ node.port }} (组: {{ node.group }})</span>
                </el-checkbox>
              </div>
            </el-checkbox-group>
          </div>
          <div class="flex justify-between items-center" v-if="subNodes.length > 0">
            <div class="text-sm">
              已选: <strong>{{ selectedSubNodes.length }}</strong> / {{ subNodes.length }}
              <el-button link type="primary" @click="selectAllSubNodes">全选</el-button>
            </div>
            <el-button type="success" :disabled="selectedSubNodes.length === 0" @click="importSubNodes">导入已选节点</el-button>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-dialog>

    <!-- V2Ray Edit Dialog -->
    <el-dialog v-model="v2rayEditDialogVisible" title="编辑 V2Ray 节点参数" width="500px" destroy-on-close>
      <el-form label-width="100px" size="small" class="mt-4">
        <el-form-item label="显示名称">
          <el-input v-model="v2rayEditForm.displayName" />
        </el-form-item>
        <el-form-item label="服务器">
          <el-input v-model="v2rayEditForm.host" />
        </el-form-item>
        <el-form-item label="端口">
          <el-input-number v-model="v2rayEditForm.port" :min="1" :max="65535" class="w-full" />
        </el-form-item>
        <el-form-item label="UUID">
          <el-input v-model="v2rayEditForm.uuid" placeholder="V2Ray UUID" />
        </el-form-item>
        <el-form-item label="传输协议">
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

    <!-- Clean Dead Nodes Dialog -->
    <el-dialog v-model="cleanDialogVisible" title="清理失效节点" width="550px" destroy-on-close>
      <div v-if="cleanState === 'idle'" class="text-center py-6">
        <el-icon :size="48" class="text-blue-500 mb-4"><Monitor /></el-icon>
        <p class="text-base mb-6 bt-text">系统将逐一测试所有节点的延迟，并为您筛选出无法连接的节点进行一键删除。</p>
        <el-button type="primary" size="large" @click="startCleanTest">开始扫描</el-button>
      </div>

      <div v-else-if="cleanState === 'testing'" class="py-6 space-y-4">
        <div class="flex justify-between items-center text-sm bt-text">
          <span>正在测试: <strong>{{ cleanCurrentNode }}</strong></span>
          <span v-if="cleanCanceled" class="text-red-500">正在中止...</span>
        </div>
        <el-progress :percentage="cleanProgress" :status="cleanCanceled ? 'exception' : ''" />
        <div class="flex justify-between items-center mt-4">
          <span class="text-xs text-gray-500">已发现 {{ cleanFailedNodes.length }} 个失效节点</span>
          <el-button type="danger" plain size="small" @click="cancelCleanTest" :disabled="cleanCanceled">中止扫描</el-button>
        </div>
      </div>

      <div v-else-if="cleanState === 'done'" class="space-y-4">
        <el-alert v-if="cleanFailedNodes.length === 0" title="扫描完成" type="success" description="没有发现失效节点，您的节点池非常健康！" show-icon :closable="false" />
        <div v-else>
          <el-alert title="扫描完成" type="warning" :description="`共发现 ${cleanFailedNodes.length} 个失效节点，请勾选需要删除的节点。`" show-icon :closable="false" class="mb-4" />
          
          <div class="max-h-60 overflow-y-auto border rounded p-2" style="border-color: var(--bt-border)">
            <el-checkbox-group v-model="cleanSelectedNodeIds">
              <div v-for="node in cleanFailedNodes" :key="node.id" class="flex items-center gap-2 py-1">
                <el-checkbox :label="node.id" class="w-full">
                  <div class="flex items-center gap-2 truncate">
                    <el-tag size="small" :type="node.type === 'v2ray' ? 'success' : 'primary'">{{ node.type.toUpperCase() }}</el-tag>
                    <span :title="node.displayName" class="truncate">{{ node.displayName }}</span>
                  </div>
                </el-checkbox>
              </div>
            </el-checkbox-group>
          </div>
          
          <div class="flex justify-end mt-4">
            <el-button @click="cleanDialogVisible = false">取消</el-button>
            <el-button type="danger" @click="confirmCleanNodes" :disabled="cleanSelectedNodeIds.length === 0">删除选中 ({{ cleanSelectedNodeIds.length }})</el-button>
          </div>
        </div>
        <div v-if="cleanFailedNodes.length === 0" class="flex justify-end mt-4">
          <el-button @click="cleanDialogVisible = false">关闭</el-button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Delete, Monitor, Connection, DocumentCopy, Check, Edit, Search, FolderOpened, Folder, ArrowDown, ArrowRight, Clock, Odometer, Share, FullScreen } from '@element-plus/icons-vue';
import { parseProxyUrl, decodeV2RayUrl, encodeV2RayUrl } from '../utils/v2rayParser';
import jsQR from 'jsqr';
import QrcodeVue from 'qrcode.vue';

const props = defineProps({
  config: Object
});

const generateId = () => Math.random().toString(36).substr(2, 9);

const importDialogVisible = ref(false);
const importTab = ref('text');
const importText = ref('');
const manualForm = ref({ displayName: '自建节点', type: 'socks5', host: '', port: 1080, user: '', pass: '', group: 'default' });
const testingNode = ref(null);
const testingSpeedNode = ref(null);
const testingAllLatency = ref(false);
const testingAllSpeed = ref(false);
const testTargetLatency = ref('www.bing.com:443');
const testTargetSpeed = ref('speed.cloudflare.com:443');
const searchQuery = ref('');

const cleanDialogVisible = ref(false);
const cleanState = ref('idle'); // 'idle', 'testing', 'done'
const cleanProgress = ref(0);
const cleanCurrentNode = ref('');
const cleanFailedNodes = ref([]);
const cleanSelectedNodeIds = ref([]);
const cleanCanceled = ref(false);

const collapsedGroups = ref({});
const toggleGroup = (groupName) => {
  collapsedGroups.value[groupName] = !collapsedGroups.value[groupName];
};

const subUrl = ref('');
const subName = ref('');
const subGroup = ref('');
const fetchingSub = ref(false);
const subNodes = ref([]);
const selectedSubNodes = ref([]);

const qrResult = ref('');

const shareDialogVisible = ref(false);
const shareNode = ref(null);
const shareNodeUrl = ref('');

// Computed Groups
const allGroups = computed(() => {
  const groups = new Set(props.config.proxyGroups || ['default']);
  if (props.config.proxyNodes) {
    props.config.proxyNodes.forEach(n => groups.add(n.group || 'default'));
  }
  return Array.from(groups);
});

// Computed Grouped and Filtered Nodes
const groupedNodes = computed(() => {
  const groups = {};
  if (props.config.proxyGroups) {
    props.config.proxyGroups.forEach(g => groups[g] = []);
  }

  let nodes = props.config.proxyNodes || [];
  
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    nodes = nodes.filter(n => 
      (n.displayName && n.displayName.toLowerCase().includes(q)) || 
      (n.host && n.host.toLowerCase().includes(q)) ||
      (n.group && n.group.toLowerCase().includes(q))
    );
  }

  nodes.forEach(n => {
    const g = n.group || 'default';
    if (!groups[g]) groups[g] = [];
    groups[g].push(n);
  });
  return groups;
});

const createGroup = async () => {
  try {
    const { value } = await ElMessageBox.prompt('请输入新的分组名称', '新建分组', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputPattern: /\S+/,
      inputErrorMessage: '分组名称不能为空'
    });
    if (value) {
      if (!props.config.proxyGroups) props.config.proxyGroups = [];
      if (!props.config.proxyGroups.includes(value)) {
        props.config.proxyGroups.push(value);
        ElMessage.success(`分组 ${value} 创建成功`);
      } else {
        ElMessage.warning('该分组已存在');
      }
    }
  } catch(e) {}
};

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

const getNodeUrl = (node) => {
  if (node.type === 'v2ray') return node.rawUrl;
  let auth = '';
  if (node.user) {
    auth = `${node.user}:${node.pass || ''}@`;
  }
  return `${node.type}://${auth}${node.host}:${node.port}#${encodeURIComponent(node.displayName)}`;
};

const openShareDialog = (node) => {
  shareNode.value = node;
  shareNodeUrl.value = getNodeUrl(node);
  shareDialogVisible.value = true;
};

const copyNodeLink = async () => {
  if (!shareNodeUrl.value) return;
  try {
    await navigator.clipboard.writeText(shareNodeUrl.value);
    ElMessage.success('节点链接已复制到剪贴板');
    shareDialogVisible.value = false;
  } catch(e) {
    ElMessage.error('复制失败');
  }
};

const handleQRUpload = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code) {
        qrResult.value = code.data;
        importText.value = (importText.value ? importText.value + '\n' : '') + code.data;
        ElMessage.success('二维码解析成功，已填入批量导入文本框中');
        setTimeout(() => {
          importTab.value = 'text';
          qrResult.value = '';
        }, 1500);
      } else {
        ElMessage.error('未识别到二维码，请换一张清晰的图片');
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  event.target.value = ''; // reset
};

const fetchSubscription = async () => {
  if (!subUrl.value) return ElMessage.warning('请输入订阅链接');
  fetchingSub.value = true;
  try {
    const res = await fetch('/api/fetch-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        url: subUrl.value,
        subName: subName.value,
        subGroup: subGroup.value
      })
    });
    const data = await res.json();
    if (data.success) {
      subNodes.value = data.nodes;
      selectedSubNodes.value = [...data.nodes];
      ElMessage.success(`成功解析 ${data.nodes.length} 个节点`);
      if (data.errors) {
        ElMessage.warning(`部分链接失败: ${data.errors.join(', ')}`);
      }
    } else {
      ElMessage.error(data.message || '获取失败');
    }
  } catch(e) {
    ElMessage.error('请求失败');
  } finally {
    fetchingSub.value = false;
  }
};

const selectAllSubNodes = () => {
  selectedSubNodes.value = [...subNodes.value];
};

const importSubNodes = () => {
  if (!props.config.proxyNodes) props.config.proxyNodes = [];
  let count = 0;
  for (const node of selectedSubNodes.value) {
    props.config.proxyNodes.push({
      id: 'node_' + generateId(),
      ...node
    });
    count++;
  }
  ElMessage.success(`成功导入 ${count} 个订阅节点`);
  importDialogVisible.value = false;
};

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
  manualForm.value = { displayName: '自建节点', type: 'socks5', host: '', port: 1080, user: '', pass: '', group: 'default' };
  importTab.value = 'text';
  subUrl.value = '';
  subName.value = '';
  subGroup.value = '';
  subNodes.value = [];
  selectedSubNodes.value = [];
  qrResult.value = '';
  importDialogVisible.value = true;
};

const deleteNode = (nodeId) => {
  const idx = props.config.proxyNodes.findIndex(n => n.id === nodeId);
  if (idx !== -1) {
    props.config.proxyNodes.splice(idx, 1);
  }
  // Also remove from chains
  if (props.config.proxyChains) {
    props.config.proxyChains.forEach(chain => {
      if (chain.nodes) {
        chain.nodes = chain.nodes.filter(id => id !== nodeId);
      }
    });
  }
};

const testLatency = async (nodeId, silent = false) => {
  testingNode.value = nodeId;
  try {
    const parts = testTargetLatency.value.split(':');
    const targetHost = parts[0] || 'www.bing.com';
    const targetPort = parseInt(parts[1]) || 443;

    const res = await fetch('/api/test-latency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'node', id: nodeId, targetHost, targetPort })
    });
    const data = await res.json();
    const node = props.config.proxyNodes.find(n => n.id === nodeId);
    
    if (data.success) {
      if (node) node._latency = data.latency;
      if (!silent) ElMessage.success(`测试成功! 延迟: ${data.latency}ms`);
    } else {
      if (node) node._latency = null;
      if (!silent) ElMessage.error(`测试失败: ${data.message}`);
    }
  } catch (err) {
    if (!silent) ElMessage.error('请求失败');
  } finally {
    if (testingNode.value === nodeId) testingNode.value = null;
  }
};

const testSpeed = async (nodeId, silent = false) => {
  testingSpeedNode.value = nodeId;
  try {
    const parts = testTargetSpeed.value.split(':');
    const targetHost = parts[0] || 'speed.cloudflare.com';
    const targetPort = parseInt(parts[1]) || 443;

    const res = await fetch('/api/test-speed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'node', id: nodeId, targetHost, targetPort })
    });
    const data = await res.json();
    const node = props.config.proxyNodes.find(n => n.id === nodeId);
    
    if (data.success) {
      if (node) node._speed = data.speed;
      if (!silent) ElMessage.success(`测试成功! 预估速度: ${data.speed} MB/s`);
    } else {
      if (node) node._speed = null;
      if (!silent) ElMessage.error(`测试失败: ${data.message}`);
    }
  } catch (err) {
    if (!silent) ElMessage.error('请求失败');
  } finally {
    if (testingSpeedNode.value === nodeId) testingSpeedNode.value = null;
  }
};

const testAllLatency = async () => {
  if (!props.config.proxyNodes || props.config.proxyNodes.length === 0) return;
  testingAllLatency.value = true;
  ElMessage.info('开始全部节点延迟测试，请稍候...');
  const promises = props.config.proxyNodes.map(n => testLatency(n.id, true));
  await Promise.allSettled(promises);
  testingAllLatency.value = false;
  ElMessage.success('全部节点延迟测试完成');
};

const testAllSpeed = async () => {
  if (!props.config.proxyNodes || props.config.proxyNodes.length === 0) return;
  testingAllSpeed.value = true;
  ElMessage.info('开始全部节点测速，请稍候...');
  const promises = props.config.proxyNodes.map(n => testSpeed(n.id, true));
  await Promise.all(promises);
  testingAllSpeed.value = false;
  ElMessage.success('全部节点测速完成');
};

const openCleanDialog = () => {
  cleanDialogVisible.value = true;
  cleanState.value = 'idle';
  cleanProgress.value = 0;
  cleanCurrentNode.value = '';
  cleanFailedNodes.value = [];
  cleanSelectedNodeIds.value = [];
  cleanCanceled.value = false;
};

const cancelCleanTest = () => {
  cleanCanceled.value = true;
};

const startCleanTest = async () => {
  const nodes = props.config.proxyNodes || [];
  if (nodes.length === 0) return;
  
  cleanState.value = 'testing';
  cleanCanceled.value = false;
  cleanFailedNodes.value = [];
  
  const parts = testTargetLatency.value.split(':');
  const targetHost = parts[0] || 'www.bing.com';
  const targetPort = parseInt(parts[1]) || 443;
  
  for (let i = 0; i < nodes.length; i++) {
    if (cleanCanceled.value) break;
    
    const node = nodes[i];
    cleanCurrentNode.value = node.displayName;
    cleanProgress.value = Math.floor((i / nodes.length) * 100);
    
    try {
      const res = await fetch('/api/test-latency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'node', id: node.id, targetHost, targetPort })
      });
      const data = await res.json();
      if (!data.success) {
        cleanFailedNodes.value.push(node);
      }
    } catch (err) {
      cleanFailedNodes.value.push(node);
    }
  }
  
  cleanProgress.value = 100;
  cleanSelectedNodeIds.value = cleanFailedNodes.value.map(n => n.id);
  cleanState.value = 'done';
};

const confirmCleanNodes = () => {
  cleanSelectedNodeIds.value.forEach(id => {
    deleteNode(id);
  });
  cleanDialogVisible.value = false;
  ElMessage.success(`成功删除了 ${cleanSelectedNodeIds.value.length} 个失效节点`);
};

const readClipboard = async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      importText.value = (importText.value ? importText.value + '\n' : '') + text;
      ElMessage.success('已追加剪贴板内容');
    } else {
      ElMessage.warning('剪贴板为空');
    }
  } catch (err) {
    ElMessage.error('无法读取剪贴板，请手动粘贴');
  }
};

const doImportText = () => {
  if (!importText.value) return;
  
  let textToParse = importText.value;
  if (!textToParse.includes('://') && /^[A-Za-z0-9+/=\s]+$/.test(textToParse.trim())) {
    try {
      textToParse = atob(textToParse.replace(/\s/g, ''));
    } catch (e) {}
  }
  
  const urls = textToParse.split('\n').map(s => s.trim()).filter(s => s);
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
          group: 'default',
          type: 'v2ray',
          v2rayType: parsed.v2rayType,
          rawUrl: parsed.rawUrl
        });
        imported++;
      } else {
        props.config.proxyNodes.push({
          id: nodeId,
          displayName: `${parsed.type.toUpperCase()} Node`,
          group: 'default',
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
