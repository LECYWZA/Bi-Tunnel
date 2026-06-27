<template>
  <div>
    <div class="space-y-6">
    <el-card shadow="hover" class="bt-card">
      <template #header>
        <div class="flex justify-between items-center">
          <div class="flex items-center gap-2">
            <el-icon class="text-purple-500"><HelpFilled /></el-icon>
            <span class="font-bold text-base">混合代理配置</span>
          </div>
          <el-dropdown @command="handleAddProxy">
            <el-button type="primary" plain size="small" :icon="Plus">
              添加代理<el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="server">添加服务端代理 (Server Proxy)</el-dropdown-item>
                <el-dropdown-item command="client">添加客户端代理 (Client Proxy)</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </template>

      <el-empty v-if="allProxies.length === 0" description="暂无代理服务" :image-size="40" />

      <div v-else class="space-y-4">
        <el-card v-for="(item, index) in allProxies" :key="index" shadow="never" class="mb-4 bt-card" style="background: var(--bt-surface); border: 1px solid var(--bt-border);">
          <div class="flex justify-between items-center mb-2 pb-2" style="border-bottom: 1px solid var(--bt-border);">
            <div class="flex items-center gap-2">
              <el-radio-group :model-value="item._mode" size="small" @change="(newMode) => switchProxyMode(item._mode, newMode, item._ref)">
                <el-radio-button label="server">服务端代理</el-radio-button>
                <el-radio-button label="client">客户端代理</el-radio-button>
              </el-radio-group>
              <span class="text-sm font-bold text-gray-600">代理监听端口: {{ item._ref.listenPort }}</span>
            </div>
            
            <div class="flex items-center gap-2">
              <el-switch v-model="item._ref.enabled" inline-prompt active-text="已启用" inactive-text="已停用" />
              <el-tooltip content="将此代理设为 Windows 系统的全局代理。开启后，本机的所有网络请求都会经过此代理。" placement="top">
                <el-switch 
                  v-model="item._ref.isSystemProxy" 
                  inline-prompt 
                  active-text="全局代理" 
                  inactive-text="全局代理" 
                  @change="toggleSystemProxy(item._ref)"
                  :disabled="item._ref.enabled === false"
                />
              </el-tooltip>
              <el-button type="danger" circle plain :icon="Delete" size="small" @click="removeProxy(item._mode, item._ref)" />
            </div>
          </div>
          
          <el-form label-position="top">
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item class="mb-2">
                  <template #label>
                    <div class="flex items-center gap-1">
                      <span>监听端口</span>
                      <el-tooltip content="代理服务将在您本地电脑或服务器上开放的端口。软件或浏览器将连接到此端口。" placement="top">
                        <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                      </el-tooltip>
                    </div>
                  </template>
                  <el-input-number v-model="item._ref.listenPort" :min="1" :max="65535" class="w-full" controls-position="right" />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item class="mb-2">
                  <template #label>
                    <div class="flex items-center gap-1">
                      <span>监听 IP</span>
                      <el-tooltip content="允许哪些设备连接到此代理。0.0.0.0 允许局域网/公网所有设备连接，127.0.0.1 仅允许本机连接。" placement="top">
                        <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                      </el-tooltip>
                    </div>
                  </template>
                  <el-autocomplete
                    v-model="item._ref.listenIp"
                    :fetch-suggestions="(q, cb) => cb(availableIps.map(ip => ({ value: ip })))"
                    placeholder="0.0.0.0"
                    class="w-full"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="24">
                <el-form-item class="mb-2">
                  <template #label>
                    <div class="flex items-center gap-1">
                      <span>出网网络</span>
                      <el-tooltip placement="top">
                        <template #content>
                          <b>使用对端网络出网：</b> 您的请求将穿透 Bi-Tunnel 隧道，以远端服务器的身份访问目标网站。<br/>
                          <b>使用本地网络出网：</b> 不穿透隧道，直接用您当前电脑的网络访问目标网站。
                        </template>
                        <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                      </el-tooltip>
                    </div>
                  </template>
                  <el-select v-model="item._ref.useRemoteNetwork" class="w-full">
                    <el-option label="使用对端网络出网" :value="true" />
                    <el-option label="使用本地网络出网" :value="false" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="24" v-if="item._mode === 'server' && item._ref.useRemoteNetwork">
                <el-form-item class="mb-2">
                  <template #label>
                    <div class="flex items-center gap-1">
                      <span class="text-blue-600">目标客户端 ID</span>
                      <el-tooltip content="指定该代理出网时应通过哪个客户端的网络。" placement="top">
                        <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                      </el-tooltip>
                    </div>
                  </template>
                  <el-autocomplete
                    v-model="item._ref.targetClientId"
                    :fetch-suggestions="(q, cb) => cb((config.server.knownClients || []).map(c => ({ value: c.id })))"
                    placeholder="目标客户端 ID"
                    class="w-full"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="24" v-if="item._mode === 'client' && item._ref.useRemoteNetwork">
                <el-form-item class="mb-2">
                  <template #label>
                    <div class="flex items-center gap-1">
                      <span class="text-blue-600">承载服务端</span>
                      <el-tooltip content="指定该代理出网时应通过哪条服务端隧道。" placement="top">
                        <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                      </el-tooltip>
                    </div>
                  </template>
                  <el-select v-model="item._ref.targetClientId" placeholder="请选择承载服务端" class="w-full">
                    <el-option v-for="c in (config.client.connections || [])" :key="c.id" :label="c.alias" :value="c.id" />
                    <!-- Legacy fallback -->
                    <el-option v-if="!(config.client.connections || []).some(c => c.id === item._ref.targetClientId)" :label="item._ref.targetClientId" :value="item._ref.targetClientId" />
                  </el-select>
                </el-form-item>
              </el-col>
            </el-row>

            <div class="p-3 rounded my-3" style="background: var(--bt-surface); border: 1px solid var(--bt-border);">
              <div class="flex justify-between items-center mb-2">
                <div class="flex items-center gap-1">
                  <span class="font-bold text-gray-700 text-sm">密码认证</span>
                  <el-tooltip content="开启后，使用此代理必须输入您设置的用户名和密码，防止被他人恶意蹭网。" placement="top">
                    <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                  </el-tooltip>
                </div>
                <el-switch v-model="item._ref.useAuth" />
              </div>
              <el-collapse-transition>
                <div v-show="item._ref.useAuth">
                  <div v-if="!item._ref.users || item._ref.users.length === 0" class="mb-2">
                    <el-button size="small" plain @click="ensureUsers(item._ref)">设置账号密码</el-button>
                  </div>
                  <div v-else>
                    <div v-for="(u, idx) in item._ref.users" :key="idx" class="flex gap-2 items-center mb-2">
                      <el-input v-model="u.user" placeholder="用户名" :prefix-icon="User" size="small" />
                      <el-input v-model="u.pass" placeholder="密码" show-password :prefix-icon="Lock" size="small" />
                      <el-button type="danger" link :icon="Delete" @click="item._ref.users.splice(idx, 1)" />
                    </div>
                    <el-button type="primary" link size="small" :icon="Plus" @click="item._ref.users.push({user:'', pass:''})">添加账号</el-button>
                  </div>
                </div>
              </el-collapse-transition>
            </div>

            <div class="mt-4 pt-4 flex items-center justify-between" style="border-top: 1px dashed var(--bt-border);">
              <div class="flex items-center gap-2 text-sm text-gray-500">
                <el-icon><Guide /></el-icon>
                <span>高级策略配置</span>
              </div>
              <div class="flex gap-2">
                <el-button type="primary" plain :icon="Setting" size="small" @click="openRoutingDialog(item._ref)">分流规则表</el-button>
                <el-button type="warning" plain :icon="Setting" size="small" @click="openAclDialog(item._ref)">访问控制 (ACL)</el-button>
              </div>
            </div>
          </el-form>
        </el-card>
      </div>
    </el-card>
  </div>

  <!-- Advanced Routing Dialog -->
  <el-dialog v-model="routingDialogVisible" title="分流规则表配置" width="80%" destroy-on-close>
    <div v-if="currentProxy">
      <div class="mb-5 p-4 rounded-md" style="background: var(--bt-surface); border: 1px solid var(--bt-border);">
        <div class="flex justify-between items-center mb-3">
          <div class="flex items-center gap-1">
            <span class="font-bold text-sm text-gray-800">分流规则表</span>
            <el-tooltip effect="dark" placement="top" style="max-width: 300px;">
              <template #content>
                规则按<b>从上到下</b>的顺序匹配，命中即生效。<br/>
                支持通配符，例如: <code>*.google.com</code> 或 <code>192.168.*.*</code><br/>
                若未命中任何规则，将执行下方的“默认动作”。
              </template>
              <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
            </el-tooltip>
          </div>
          <el-button type="primary" plain size="small" :icon="Plus" @click="addRule(currentProxy)">添加规则</el-button>
        </div>
        
        <div class="text-xs text-gray-400 mb-2 flex items-center gap-1">
          <el-icon><InfoFilled /></el-icon> 支持拖拽调整规则优先级。按从上到下的顺序依次匹配。
        </div>
        
        <draggable v-model="currentProxy.proxyRules" item-key="id" handle=".drag-handle" animation="300" ghost-class="ghost">
          <template #item="{ element: rule, index: rIdx }">
            <div class="flex items-center gap-3 p-3 mb-2 rounded-md relative group" style="background: var(--bt-input-bg); border: 1px solid var(--bt-border);">
              <el-icon class="drag-handle cursor-move text-gray-400 hover:text-blue-500 transition-colors" :size="20"><Sort /></el-icon>
              
              <div class="flex-1 grid grid-cols-[1fr_auto_1fr] gap-4 items-center">
                <!-- Match Pattern -->
                <div class="flex items-center rounded overflow-hidden" style="background: var(--bt-surface); border: 1px solid var(--bt-border);">
                  <span class="text-xs text-gray-500 px-3 py-1.5 select-none whitespace-nowrap" style="background: var(--bt-surface); border-right: 1px solid var(--bt-border);">匹配规则</span>
                  <el-select 
                    v-model="rule.pattern" 
                    multiple
                    collapse-tags
                    collapse-tags-tooltip
                    allow-create 
                    filterable 
                    default-first-option
                    placeholder="例如: geoip:cn 或 *.google.com" 
                    class="rule-input flex-1" 
                    style="width: 100%;"
                  >
                    <el-option-group label="基于 GeoIP 分流 (国内外路由)">
                      <el-option label="匹配国内 IP (geoip:cn)" value="geoip:cn" />
                      <el-option label="匹配非国内/海外 IP (geoip:!cn)" value="geoip:!cn" />
                    </el-option-group>
                    <el-option-group label="内网与私有地址">
                      <el-option label="10.x.x.x (10.*.*.*)" value="10.*.*.*" />
                      <el-option label="172.16-31.x.x (172.*.*.*)" value="172.*.*.*" />
                      <el-option label="192.168.x.x (192.168.*.*)" value="192.168.*.*" />
                      <el-option label="Localhost (127.*.*.* | localhost)" value="127.*.*.*" />
                    </el-option-group>
                    <el-option-group label="常用域名分流">
                      <el-option label="匹配所有 (兜底规则) (*)" value="*" />
                      <el-option label="谷歌服务 (*.google.com)" value="*.google.com" />
                      <el-option label="YouTube (*.youtube.com)" value="*.youtube.com" />
                      <el-option label="OpenAI (*.openai.com)" value="*.openai.com" />
                      <el-option label="GitHub (*.github.com)" value="*.github.com" />
                      <el-option label="HuggingFace (*.huggingface.co)" value="*.huggingface.co" />
                      <el-option label="Docker (*.docker.com)" value="*.docker.com" />
                      <el-option label="Telegram (*.telegram.org)" value="*.telegram.org" />
                      <el-option label="微软服务 (*.microsoft.com)" value="*.microsoft.com" />
                    </el-option-group>
                  </el-select>
                </div>

                <el-icon class="text-gray-400"><Right /></el-icon>

                <!-- Route Action -->
                <div class="flex items-center rounded overflow-hidden" style="background: var(--bt-surface); border: 1px solid var(--bt-border);">
                  <span class="text-xs text-gray-500 px-3 py-1.5 select-none whitespace-nowrap" style="background: var(--bt-surface); border-right: 1px solid var(--bt-border);">转发至</span>
                  <el-select v-model="rule.action" class="rule-select flex-1" style="width: 100%;" multiple collapse-tags collapse-tags-tooltip placeholder="请选择目标 (支持多选)">
                    <el-option-group label="内置动作">
                      <el-option label="直连 (本地网络)" value="direct_local" />
                      <el-option label="直连 (远端隧道)" value="direct_remote" />
                      <el-option label="拒绝连接" value="block" />
                    </el-option-group>
                    <el-option-group label="全局代理链" v-if="config.proxyChains && config.proxyChains.length">
                      <el-option v-for="chain in config.proxyChains" :key="chain.id" :label="`走代理链: ${chain.name}`" :value="`chain:${chain.id}`" />
                    </el-option-group>
                    <el-option-group label="单一代理节点" v-if="config.proxyNodes && config.proxyNodes.length">
                      <el-option v-for="node in config.proxyNodes" :key="node.id" :label="`走节点: ${node.displayName}`" :value="`node:${node.id}`" />
                    </el-option-group>
                  </el-select>
                </div>
              </div>

              <el-button type="danger" link :icon="Delete" @click="currentProxy.proxyRules.splice(rIdx, 1)" class="opacity-0 group-hover:opacity-100 transition-opacity ml-2" />
            </div>
          </template>
        </draggable>

        <el-empty v-if="!currentProxy.proxyRules || currentProxy.proxyRules.length === 0" description="暂无规则，将执行下方默认动作" :image-size="40" />

        <div class="mt-4 flex items-center justify-end gap-2 p-2 rounded" style="background: var(--bt-input-bg); border: 1px solid var(--bt-border);">
          <el-tooltip content="当以上所有规则都没有命中时，流量将执行此动作。" placement="top">
            <el-icon class="text-gray-400"><InfoFilled /></el-icon>
          </el-tooltip>
          <span class="text-xs font-bold text-gray-700">默认兜底动作:</span>
          <el-select v-model="currentProxy.defaultRuleAction" size="small" style="width: 220px;" multiple collapse-tags collapse-tags-tooltip placeholder="请选择兜底动作 (支持多选)">
            <el-option-group label="内置动作">
              <el-option label="直连 (本地网络)" value="direct_local" />
              <el-option label="直连 (远端隧道)" value="direct_remote" />
              <el-option label="拒绝连接" value="block" />
            </el-option-group>
            <el-option-group label="全局代理链" v-if="config.proxyChains && config.proxyChains.length">
              <el-option v-for="chain in config.proxyChains" :key="chain.id" :label="`走代理链: ${chain.name}`" :value="`chain:${chain.id}`" />
            </el-option-group>
            <el-option-group label="单一代理节点" v-if="config.proxyNodes && config.proxyNodes.length">
              <el-option v-for="node in config.proxyNodes" :key="node.id" :label="`走节点: ${node.displayName}`" :value="`node:${node.id}`" />
            </el-option-group>
          </el-select>
        </div>
      </div>
    </div>
  </el-dialog>

  <!-- ACL Dialog -->
  <el-dialog v-model="aclDialogVisible" title="访问控制 (ACL)" width="800px" destroy-on-close>
    <div v-if="currentProxy">
      <div class="flex items-center gap-1 mb-1">
        <span class="font-bold text-xs text-gray-700">来源 IP 控制</span>
        <el-tooltip effect="dark" placement="top" style="max-width: 300px;">
          <template #content>
            控制<b>哪些设备的 IP</b>可以连接到您的这个代理端口。<br/>
            - 白名单: 只有列表中的 IP 可以连接（一行一个）<br/>
            - 黑名单: 列表中的 IP 会被拒绝连接<br/>
            如果白名单为空，则默认允许所有来源。
          </template>
          <el-icon class="text-gray-400 cursor-pointer text-xs"><InfoFilled /></el-icon>
        </el-tooltip>
      </div>
      <el-input v-model="currentProxy._allowIps" type="textarea" :rows="3" placeholder="白名单 (每行一个 IP)" class="mb-2" />
      <el-input v-model="currentProxy._denyIps" type="textarea" :rows="3" placeholder="黑名单 (每行一个 IP)" class="mb-4" />

      <div class="flex items-center gap-1 mb-1">
        <span class="font-bold text-xs text-gray-700">目标 IP 控制</span>
        <el-tooltip effect="dark" placement="top" style="max-width: 300px;">
          <template #content>
            控制这个代理<b>能够访问哪些目标 IP</b>。<br/>
            （注：这是旧版简单的 ACL 拦截，仅支持 IP。如果您需要更强大的按域名或通配符拦截，建议留空此项，使用上方的高级“分流规则表”。）
          </template>
          <el-icon class="text-gray-400 cursor-pointer text-xs"><InfoFilled /></el-icon>
        </el-tooltip>
      </div>
      <el-input v-model="currentProxy._targetAllowIps" type="textarea" :rows="3" placeholder="目标白名单 (建议使用上方的分流规则表)" class="mb-2" />
      <el-input v-model="currentProxy._targetDenyIps" type="textarea" :rows="3" placeholder="目标黑名单 (建议使用上方的分流规则表)" />
    </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import draggable from 'vuedraggable';
import { Delete, Plus, User, Lock, Switch, HelpFilled, InfoFilled, Sort, Right, Setting, Guide, ArrowDown } from '@element-plus/icons-vue';

const props = defineProps({
  config: Object,
  availableIps: {
    type: Array,
    default: () => ['0.0.0.0', '127.0.0.1']
  }
});

const routingDialogVisible = ref(false);
const aclDialogVisible = ref(false);
const currentProxy = ref(null);

const allProxies = computed(() => {
  const arr = [];
  if (props.config.server?.proxies) {
    arr.push(...props.config.server.proxies.map(p => ({ _mode: 'server', _ref: p })));
  }
  if (props.config.client?.proxies) {
    arr.push(...props.config.client.proxies.map(p => ({ _mode: 'client', _ref: p })));
  }
  return arr;
});

const handleAddProxy = (mode) => {
  if (!props.config[mode].proxies) props.config[mode].proxies = [];
  props.config[mode].proxies.push({
    enabled: true,
    listenPort: 1080,
    listenIp: '0.0.0.0',
    isSystemProxy: false,
    useAuth: false,
    users: [{ user: '', pass: '' }],
    useRemoteNetwork: true,
    _allowIps: '',
    _denyIps: '',
    _targetAllowIps: '',
    _targetDenyIps: '',
    proxyRules: [],
    chainNodes: [],
    defaultRuleAction: ['direct_local']
  });
};

const removeProxy = (mode, refObj) => {
  const arr = props.config[mode].proxies;
  const idx = arr.indexOf(refObj);
  if (idx !== -1) arr.splice(idx, 1);
};

const switchProxyMode = (oldMode, newMode, refObj) => {
  if (oldMode === newMode) return;
  const oldArr = props.config[oldMode].proxies;
  const newArr = props.config[newMode].proxies;
  const idx = oldArr.indexOf(refObj);
  if (idx !== -1) {
    oldArr.splice(idx, 1);
    newArr.push(refObj);
    ElMessage.success(`已切换为${newMode === 'server' ? '服务端代理' : '客户端代理'}`);
  }
};

const ensureUsers = (px) => {
  if (!px.users) {
    px.users = [];
    if (px.user) px.users.push({ user: px.user, pass: px.pass });
    else px.users.push({ user: '', pass: '' });
  } else if (px.users.length === 0) {
    px.users.push({ user: '', pass: '' });
  }
};

const openRoutingDialog = (px) => {
  currentProxy.value = px;
  routingDialogVisible.value = true;
};

const openAclDialog = (px) => {
  currentProxy.value = px;
  aclDialogVisible.value = true;
};

const addRule = (px) => {
  if (!px.proxyRules) px.proxyRules = [];
  px.proxyRules.push({ id: Math.random().toString(36).substr(2, 9), pattern: [], action: ['direct_local'] });
};

const toggleSystemProxy = async (px) => {
  try {
    if (px.isSystemProxy) {
      // First turn off any other proxies that might have this flag on
      ['server', 'client'].forEach(m => {
        (props.config[m]?.proxies || []).forEach(p => {
          if (p !== px) p.isSystemProxy = false;
        });
      });
      const res = await fetch('/api/system-proxy/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: '127.0.0.1', port: px.listenPort })
      });
      const data = await res.json();
      if (data.success) {
        ElMessage.success('已开启全局系统代理');
      } else {
        px.isSystemProxy = false;
        ElMessage.error('无法开启系统代理，请检查权限');
      }
    } else {
      const res = await fetch('/api/system-proxy/disable', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        ElMessage.success('已关闭全局系统代理并恢复原样');
      } else {
        ElMessage.error('关闭系统代理失败');
      }
    }
  } catch (err) {
    px.isSystemProxy = !px.isSystemProxy;
    ElMessage.error('请求失败: ' + err.message);
  }
};
</script>

<style scoped>
.ghost {
  opacity: 0.5;
  background: var(--bt-primary-light);
}

:deep(.rule-input .el-input__wrapper) {
  box-shadow: none !important;
  background: transparent !important;
}
:deep(.rule-select .el-input__wrapper) {
  box-shadow: none !important;
  background: transparent !important;
}
</style>
