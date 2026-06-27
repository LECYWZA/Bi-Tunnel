<template>
  <div>
    <div class="space-y-6">
    <div class="flex justify-between items-center bt-section-status sticky top-[60px] z-10 bg-white dark:bg-gray-900 -mx-6 px-6 pt-4 -mt-4 pb-4">
      <div class="flex items-center gap-3">
        <el-icon :size="24" class="text-purple-500"><HelpFilled /></el-icon>
        <span class="font-bold text-lg bt-text">混合代理配置</span>
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

    <el-empty v-if="allProxies.length === 0" description="暂无代理服务" :image-size="80" />

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6" v-else>
      <el-card v-for="(item, index) in allProxies" :key="index" shadow="hover" class="bt-card h-full transition-transform hover:-translate-y-1" body-class="flex flex-col h-full">
          <div class="flex justify-between items-center mb-2 pb-2" style="border-bottom: 1px solid var(--bt-border);">
            <div class="flex items-center gap-2">
              <el-radio-group :model-value="item._mode" size="small" @change="(newMode) => switchProxyMode(item._mode, newMode, item._ref)">
                <el-radio-button value="server">服务端代理</el-radio-button>
                <el-radio-button value="client">客户端代理</el-radio-button>
              </el-radio-group>
            </div>
            
            <div class="flex items-center gap-2">
              <el-switch v-model="item._ref.enabled" inline-prompt active-text="已启用" inactive-text="已停用" />
              <el-button type="danger" circle plain :icon="Delete" size="small" @click="removeProxy(item._mode, item._ref)" />
            </div>
          </div>
          
          <el-form label-position="top">
            <el-row :gutter="16">
              <el-col :span="24">
                <el-form-item class="mb-2">
                  <template #label>
                    <div class="flex items-center gap-1">
                      <span>代理名称</span>
                      <el-tooltip content="为此代理指定一个友好的名称，便于在顶部导航栏区分不同的代理选项。" placement="top">
                        <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                      </el-tooltip>
                    </div>
                  </template>
                  <el-input v-model="item._ref.name" placeholder="请输入代理名称 (例：办公代理/全球分流)" />
                </el-form-item>
              </el-col>
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
    </div>
  </div>

  <!-- Advanced Routing Dialog -->
  <el-dialog v-model="routingDialogVisible" title="分流规则表配置" width="60%" destroy-on-close>
    <div v-if="currentProxy">
      <div class="mb-5 p-4 rounded-md" style="background: var(--bt-surface); border: 1px solid var(--bt-border);">
        <div class="flex justify-between items-center mb-3">
          <div class="flex items-center gap-1">
            <span class="font-bold text-sm bt-text">分流规则表</span>
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
        
        <div class="text-xs bt-text-secondary mb-2 flex items-center gap-1">
          <el-icon><InfoFilled /></el-icon> 支持拖拽调整规则优先级。按从上到下的顺序依次匹配。
        </div>
        
        <draggable v-model="currentProxy.proxyRules" item-key="id" handle=".drag-handle" animation="300" ghost-class="ghost">
          <template #item="{ element: rule, index: rIdx }">
            <div class="flex items-center gap-3 p-3 mb-3 rounded-md relative group" style="background: var(--bt-input-bg); border: 1px solid var(--bt-border);">
              <el-icon class="drag-handle cursor-move bt-text-secondary hover:text-blue-500 transition-colors" :size="20"><Sort /></el-icon>
              
              <div class="flex-1 grid grid-cols-[1fr_auto_1fr] gap-4 items-start">
                <!-- Rule Cards Selector and List -->
                <div class="flex flex-col gap-2 p-2 rounded" style="background: var(--bt-surface); border: 1px solid var(--bt-border);">
                  <div class="flex flex-col gap-1.5 mb-1">
                    <span class="text-xs font-bold bt-text-secondary whitespace-nowrap">分流规则卡片 (拖拽排序/优先生效)</span>
                    <el-select
                      :model-value="''"
                      placeholder="添加规则卡片"
                      class="w-full"
                      filterable
                      @change="(val) => addRuleCardToRule(rule, val)"
                    >
                      <el-option
                        v-for="card in getAvailableRuleCards(rule)"
                        :key="card.id"
                        :label="card.name"
                        :value="card.id"
                      />
                    </el-select>
                  </div>
                  <draggable v-model="rule.ruleCardIds" item-key="this" handle=".rule-card-drag" animation="200" ghost-class="ghost">
                    <template #item="{ element: cardId, index: cIdx }">
                      <div class="flex items-center justify-between p-1.5 mb-1 rounded text-xs" style="background: var(--bt-input-bg); border: 1px solid var(--bt-border);">
                        <div class="flex items-center gap-1.5 truncate">
                          <el-icon class="rule-card-drag cursor-move bt-text-secondary" :size="14"><Sort /></el-icon>
                          <span class="font-bold bt-text truncate">{{ getRuleCardName(cardId) }}</span>
                        </div>
                        <el-button type="danger" link :icon="Delete" size="small" @click="rule.ruleCardIds.splice(cIdx, 1)" />
                      </div>
                    </template>
                  </draggable>
                  <div v-if="!rule.ruleCardIds || rule.ruleCardIds.length === 0" class="text-center text-xs bt-text-muted py-2">
                    暂无规则卡片，请选择添加
                  </div>
                </div>

                <el-icon class="text-gray-400 mt-3"><Right /></el-icon>

                <!-- Route Action Selector and List -->
                <div class="flex flex-col gap-2 p-2 rounded" style="background: var(--bt-surface); border: 1px solid var(--bt-border);">
                  <div class="flex flex-col gap-1.5 mb-1">
                    <span class="text-xs font-bold bt-text-secondary whitespace-nowrap">转发至目标 (拖拽排序/故障切换)</span>
                    <el-select
                      :model-value="''"
                      placeholder="添加转发目标"
                      class="w-full"
                      filterable
                      @change="(val) => addActionToRule(rule, val)"
                    >
                      <el-option-group label="内置动作">
                        <el-option label="直连 (本地网络)" value="direct_local" :disabled="rule.action?.includes('direct_local')" />
                        <el-option label="直连 (远端隧道)" value="direct_remote" :disabled="rule.action?.includes('direct_remote')" />
                        <el-option label="拒绝连接" value="block" :disabled="rule.action?.includes('block')" />
                      </el-option-group>
                      <el-option-group label="全局代理链" v-if="config.proxyChains && config.proxyChains.length">
                        <el-option v-for="chain in config.proxyChains" :key="chain.id" :label="`走代理链: ${chain.name}`" :value="`chain:${chain.id}`" :disabled="rule.action?.includes(`chain:${chain.id}`)" />
                      </el-option-group>
                      <el-option-group label="单一代理节点" v-if="config.proxyNodes && config.proxyNodes.length">
                        <el-option v-for="node in config.proxyNodes" :key="node.id" :label="`走节点: ${node.displayName}`" :value="`node:${node.id}`" :disabled="rule.action?.includes(`node:${node.id}`)" />
                      </el-option-group>
                    </el-select>
                  </div>
                  <draggable v-model="rule.action" item-key="this" handle=".action-drag" animation="200" ghost-class="ghost">
                    <template #item="{ element: act, index: aIdx }">
                      <div class="flex items-center justify-between p-1.5 mb-1 rounded text-xs" style="background: var(--bt-input-bg); border: 1px solid var(--bt-border);">
                        <div class="flex items-center gap-1.5 truncate">
                          <el-icon class="action-drag cursor-move bt-text-secondary" :size="14"><Sort /></el-icon>
                          <el-tag size="small" :type="getActionTagType(act)" effect="dark" class="mr-1 truncate">{{ getActionName(act) }}</el-tag>
                        </div>
                        <el-button type="danger" link :icon="Delete" size="small" @click="rule.action.splice(aIdx, 1)" />
                      </div>
                    </template>
                  </draggable>
                  <div v-if="!rule.action || rule.action.length === 0" class="text-center text-xs bt-text-muted py-2">
                    暂无转发目标，请选择添加
                  </div>
                </div>
              </div>

              <el-button type="danger" link :icon="Delete" @click="currentProxy.proxyRules.splice(rIdx, 1)" class="opacity-0 group-hover:opacity-100 transition-opacity ml-2" />
            </div>
          </template>
        </draggable>

        <el-empty v-if="!currentProxy.proxyRules || currentProxy.proxyRules.length === 0" description="暂无规则，将执行下方默认动作" :image-size="40" />

        <!-- Default Fallback Actions List -->
        <div class="mt-4 p-3 rounded flex flex-col gap-3" style="background: var(--bt-input-bg); border: 1px solid var(--bt-border);">
          <div class="flex justify-between items-center gap-4">
            <div class="flex items-center gap-1.5 shrink-0">
              <el-tooltip content="当以上所有分流规则均未命中时，流量将执行此动作。支持设置多个动作，前面的不通时将按顺序尝试下一个。" placement="top">
                <el-icon class="text-gray-400"><InfoFilled /></el-icon>
              </el-tooltip>
              <span class="text-xs font-bold bt-text whitespace-nowrap">默认兜底动作 (拖拽排序/故障切换):</span>
            </div>
            <el-select
              :model-value="''"
              placeholder="添加兜底动作"
              class="w-64"
              filterable
              @change="(val) => addDefaultAction(currentProxy, val)"
            >
              <el-option-group label="内置动作">
                <el-option label="直连 (本地网络)" value="direct_local" :disabled="currentProxy.defaultRuleAction?.includes('direct_local')" />
                <el-option label="直连 (远端隧道)" value="direct_remote" :disabled="currentProxy.defaultRuleAction?.includes('direct_remote')" />
                <el-option label="拒绝连接" value="block" :disabled="currentProxy.defaultRuleAction?.includes('block')" />
              </el-option-group>
              <el-option-group label="全局代理链" v-if="config.proxyChains && config.proxyChains.length">
                <el-option v-for="chain in config.proxyChains" :key="chain.id" :label="`走代理链: ${chain.name}`" :value="`chain:${chain.id}`" :disabled="currentProxy.defaultRuleAction?.includes(`chain:${chain.id}`)" />
              </el-option-group>
              <el-option-group label="单一代理节点" v-if="config.proxyNodes && config.proxyNodes.length">
                <el-option v-for="node in config.proxyNodes" :key="node.id" :label="`走节点: ${node.displayName}`" :value="`node:${node.id}`" :disabled="currentProxy.defaultRuleAction?.includes(`node:${node.id}`)" />
              </el-option-group>
            </el-select>
          </div>
          
          <draggable v-model="currentProxy.defaultRuleAction" item-key="this" handle=".default-action-drag" animation="200" ghost-class="ghost" class="flex flex-wrap gap-2">
            <template #item="{ element: act, index: dIdx }">
              <div class="flex items-center gap-1.5 p-1.5 rounded text-xs" style="background: var(--bt-surface); border: 1px solid var(--bt-border);">
                <el-icon class="default-action-drag cursor-move bt-text-secondary" :size="14"><Sort /></el-icon>
                <el-tag size="small" :type="getActionTagType(act)" effect="dark">{{ getActionName(act) }}</el-tag>
                <el-button type="danger" link :icon="Delete" size="small" @click="currentProxy.defaultRuleAction.splice(dIdx, 1)" />
              </div>
            </template>
          </draggable>
          <div v-if="!currentProxy.defaultRuleAction || currentProxy.defaultRuleAction.length === 0" class="text-center text-xs bt-text-muted py-1">
            暂无兜底动作，请选择添加 (至少需要一个兜底动作)
          </div>
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
    name: '',
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
  if (!props.config.ruleCards || props.config.ruleCards.length === 0) {
    ElMessage.warning('暂无分流规则卡片，请先到“分流规则”页面创建规则卡片！');
    return;
  }
  if (!px.proxyRules) px.proxyRules = [];
  const defaultCardId = props.config.ruleCards[0].id;
  px.proxyRules.push({ id: Math.random().toString(36).substr(2, 9), ruleCardIds: [defaultCardId], action: ['direct_local'] });
};

const getAvailableRuleCards = (rule) => {
  const ids = rule.ruleCardIds || [];
  return (props.config.ruleCards || []).filter(c => !ids.includes(c.id));
};

const addRuleCardToRule = (rule, cardId) => {
  if (!rule.ruleCardIds) {
    rule.ruleCardIds = [];
  }
  if (!rule.ruleCardIds.includes(cardId)) {
    rule.ruleCardIds.push(cardId);
  }
};

const getRuleCardName = (cardId) => {
  const card = (props.config.ruleCards || []).find(c => c.id === cardId);
  return card ? card.name : cardId;
};

const addActionToRule = (rule, val) => {
  if (!rule.action) {
    rule.action = [];
  }
  if (!rule.action.includes(val)) {
    rule.action.push(val);
  }
};

const getActionName = (act) => {
  if (act === 'direct_local') return '直连 (本地网络)';
  if (act === 'direct_remote') return '直连 (远端隧道)';
  if (act === 'block') return '拒绝连接';
  if (act.startsWith('chain:')) {
    const chainId = act.substring(6);
    const chain = (props.config.proxyChains || []).find(c => c.id === chainId);
    return chain ? `走代理链: ${chain.name}` : `代理链: ${chainId}`;
  }
  if (act.startsWith('node:')) {
    const nodeId = act.substring(5);
    const node = (props.config.proxyNodes || []).find(n => n.id === nodeId);
    return node ? `走节点: ${node.displayName}` : `节点: ${nodeId}`;
  }
  return act;
};

const getActionTagType = (act) => {
  if (act === 'direct_local') return 'info';
  if (act === 'direct_remote') return 'success';
  if (act === 'block') return 'danger';
  if (act.startsWith('chain:')) return 'warning';
  if (act.startsWith('node:')) return 'primary';
  return 'info';
};

const addDefaultAction = (proxy, val) => {
  if (!proxy.defaultRuleAction) {
    proxy.defaultRuleAction = [];
  }
  if (!proxy.defaultRuleAction.includes(val)) {
    proxy.defaultRuleAction.push(val);
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
