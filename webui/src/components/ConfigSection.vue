<template>
  <div class="space-y-6">
    <div class="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm">
      <div class="flex items-center gap-3">
        <el-tag :type="isRunning ? 'success' : 'info'" effect="dark" round size="large">
          {{ title }}: {{ isRunning ? '运行中' : '已停止' }}
        </el-tag>
        <el-tag v-if="mode === 'server' && isRunning" type="warning" round size="large">
          <span v-if="status.connectedClients && status.connectedClients.length > 0">
            已连接: {{ status.connectedClients.join(', ') }}
          </span>
          <span v-else>无客户端连接</span>
        </el-tag>
      </div>
      <el-button v-if="!isRunning" type="primary" :icon="VideoPlay" @click="$emit('start')" shadow>
        启动{{ title }}
      </el-button>
      <el-button v-else type="danger" :icon="VideoPause" @click="$emit('stop')" shadow>
        停止{{ title }}
      </el-button>
    </div>

    <el-card shadow="hover">
      <template #header>
        <div class="flex items-center gap-2">
          <el-icon class="text-blue-500"><Tools /></el-icon>
          <span class="font-bold text-base">基础设置</span>
        </div>
      </template>
      
      <el-form label-position="top">
        <div class="bg-blue-50 p-4 rounded mb-6 flex justify-between items-center">
          <div>
            <div class="font-bold text-blue-800 text-sm mb-1">
              自动开启此模式
            </div>
            <div class="text-xs text-blue-600">
              软件启动后，自动在后台运行
            </div>
          </div>
          <el-switch v-model="sectionConfig.autoStart" />
        </div>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item class="mb-4">
              <template #label>
                <div class="flex items-center gap-1">
                  <span>连接密码 (身份认证)</span>
                  <el-tooltip content="用于对端设备接入本隧道时的密码验证。双端密码必须完全一致。" placement="top">
                    <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                  </el-tooltip>
                </div>
              </template>
              <el-input v-model="sectionConfig.password" placeholder="请输入密码" show-password />
            </el-form-item>
          </el-col>
          <el-col :span="12" v-if="mode === 'server'">
            <el-form-item class="mb-4">
              <template #label>
                <div class="flex items-center gap-1">
                  <span>绑定 IP (监听地址)</span>
                  <el-tooltip content="服务端安全隧道监听的网卡 IP。0.0.0.0 允许外部连接，127.0.0.1 仅限本机。" placement="top">
                    <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                  </el-tooltip>
                </div>
              </template>
              <el-select v-model="sectionConfig.bindHost" class="w-full" filterable allow-create default-first-option>
                <el-option v-for="ip in availableIps" :key="ip" :label="ip" :value="ip" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12" v-if="mode === 'client'">
            <el-form-item class="mb-4">
              <template #label>
                <div class="flex items-center gap-1">
                  <span>服务端 IP</span>
                  <el-tooltip content="Bi-Tunnel 服务端所在的公网 IP 或局域网 IP 地址。" placement="top">
                    <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                  </el-tooltip>
                </div>
              </template>
              <el-input v-model="sectionConfig.tunnelHost" placeholder="例如: 127.0.0.1 或 8.8.8.8" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item class="mb-4">
              <template #label>
                <div class="flex items-center gap-1">
                  <span>隧道端口</span>
                  <el-tooltip content="Bi-Tunnel 安全通信隧道的端口号，默认为 33891。双端端口必须一致且未被占用。" placement="top">
                    <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                  </el-tooltip>
                </div>
              </template>
              <el-input-number v-model="sectionConfig.tunnelPort" :min="1" :max="65535" class="w-full" controls-position="right" />
            </el-form-item>
          </el-col>
          <el-col :span="12" v-if="mode === 'client'">
            <el-form-item class="mb-4">
              <template #label>
                <div class="flex items-center gap-1">
                  <span>客户端 ID</span>
                  <el-tooltip content="用于服务端区分多台客户端。请确保所有接入同一个服务端的客户端 ID 不冲突。" placement="top">
                    <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                  </el-tooltip>
                </div>
              </template>
              <el-input v-model="sectionConfig.clientId" placeholder="例如: client-1" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
    </el-card>

    <el-card shadow="hover">
      <template #header>
        <div class="flex justify-between items-center">
          <div class="flex items-center gap-2">
            <el-icon class="text-green-500"><Switch /></el-icon>
            <span class="font-bold text-base">端口映射</span>
          </div>
          <el-button type="primary" plain size="small" :icon="Plus" @click="addForward">添加映射</el-button>
        </div>
      </template>

      <el-empty v-if="!sectionConfig.forwards || sectionConfig.forwards.length === 0" description="暂无规则" :image-size="40" />
      
      <div v-else class="space-y-4">
        <div v-for="(fw, index) in sectionConfig.forwards" :key="index" class="bg-gray-50 p-3 rounded">
          <div class="flex justify-between items-center mb-2">
            <span class="text-xs font-bold text-gray-500">映射规则 #{{ index + 1 }}</span>
            <el-button type="danger" circle plain :icon="Delete" size="small" @click="sectionConfig.forwards.splice(index, 1)" />
          </div>
          
          <el-row :gutter="12">
            <el-col :span="mode === 'server' ? 8 : 24" class="mb-2">
              <div class="text-xs text-gray-500 mb-1">本地监听端口</div>
              <el-input-number v-model="fw.listenPort" :min="1" :max="65535" class="w-full" controls-position="right" />
            </el-col>
            <el-col :span="16" class="mb-2" v-if="mode === 'server'">
              <div class="text-xs text-gray-500 mb-1 flex items-center gap-1">
                <span>目标客户端 ID</span>
                <el-tooltip content="指定该端口转发应通过哪个客户端的网络进行出站。" placement="top">
                  <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                </el-tooltip>
              </div>
              <el-input v-model="fw.targetClientId" placeholder="例如: client-1" />
            </el-col>
            <el-col :span="14">
              <div class="text-xs text-gray-500 mb-1">目标 IP</div>
              <el-input v-model="fw.targetHost" placeholder="127.0.0.1" />
            </el-col>
            <el-col :span="10">
              <div class="text-xs text-gray-500 mb-1">目标端口</div>
              <el-input-number v-model="fw.targetPort" :min="1" :max="65535" class="w-full" controls-position="right" />
            </el-col>
          </el-row>
        </div>
      </div>
    </el-card>

    <el-card shadow="hover">
      <template #header>
        <div class="flex justify-between items-center">
          <div class="flex items-center gap-2">
            <el-icon class="text-purple-500"><HelpFilled /></el-icon>
            <span class="font-bold text-base">混合代理</span>
          </div>
          <el-button type="primary" plain size="small" :icon="Plus" @click="addProxy">添加代理</el-button>
        </div>
      </template>

      <el-empty v-if="!sectionConfig.proxies || sectionConfig.proxies.length === 0" description="暂无代理服务" :image-size="40" />

      <div v-else class="space-y-4">
        <el-card v-for="(px, index) in sectionConfig.proxies" :key="index" shadow="never" class="bg-blue-50/20 mb-4">
          <div class="flex justify-between items-center mb-2 pb-2" style="border-bottom: 1px solid #dbeafe;">
            <span class="text-sm font-bold text-gray-600">混合代理 #{{ index + 1 }}</span>
            <div class="flex items-center gap-2">
              <el-tooltip content="将此代理设为 Windows 系统的全局代理。开启后，本机的所有网络请求都会经过此代理。" placement="top">
                <el-switch 
                  v-model="px.isSystemProxy" 
                  inline-prompt 
                  active-text="已设为全局" 
                  inactive-text="设为全局" 
                  @change="toggleSystemProxy(px)"
                  :disabled="!isRunning"
                />
              </el-tooltip>
              <el-button type="danger" circle plain :icon="Delete" size="small" @click="sectionConfig.proxies.splice(index, 1)" />
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
                  <el-input-number v-model="px.listenPort" :min="1" :max="65535" class="w-full" controls-position="right" />
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
                  <el-select v-model="px.listenIp" class="w-full" filterable allow-create default-first-option>
                    <el-option v-for="ip in availableIps" :key="ip" :label="ip" :value="ip" />
                  </el-select>
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
                  <el-select v-model="px.useRemoteNetwork" class="w-full">
                    <el-option label="使用对端网络出网" :value="true" />
                    <el-option label="使用本地网络出网" :value="false" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="24" v-if="mode === 'server' && px.useRemoteNetwork">
                <el-form-item class="mb-2">
                  <template #label>
                    <div class="flex items-center gap-1">
                      <span class="text-blue-600">目标客户端 ID</span>
                      <el-tooltip content="指定该代理出网时应通过哪个客户端的网络。" placement="top">
                        <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                      </el-tooltip>
                    </div>
                  </template>
                  <el-input v-model="px.targetClientId" placeholder="例如: client-1" />
                </el-form-item>
              </el-col>
            </el-row>

            <div class="bg-white p-3 rounded my-3">
              <div class="flex justify-between items-center mb-2">
                <div class="flex items-center gap-1">
                  <span class="font-bold text-gray-700 text-sm">密码认证</span>
                  <el-tooltip content="开启后，使用此代理必须输入您设置的用户名和密码，防止被他人恶意蹭网。" placement="top">
                    <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                  </el-tooltip>
                </div>
                <el-switch v-model="px.useAuth" />
              </div>
              <el-collapse-transition>
                <div v-show="px.useAuth">
                  <el-row :gutter="12">
                    <el-col :span="12">
                      <el-input v-model="px.user" placeholder="用户名" :prefix-icon="User" />
                    </el-col>
                    <el-col :span="12">
                      <el-input v-model="px.pass" placeholder="密码" show-password :prefix-icon="Lock" />
                    </el-col>
                  </el-row>
                </div>
              </el-collapse-transition>
            </div>

            <el-collapse class="mt-4 border-t-0">
              <el-collapse-item name="1" title="高级路由与代理链配置" class="bg-transparent">
                <!-- Routing Rules -->
                <div class="mb-5 bg-white p-4 rounded-md shadow-sm" style="border: 1px solid #f3f4f6;">
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
                    <el-button type="primary" plain size="small" :icon="Plus" @click="addRule(px)">添加规则</el-button>
                  </div>
                  
                  <div class="text-xs text-gray-400 mb-2 flex items-center gap-1">
                    <el-icon><InfoFilled /></el-icon> 支持拖拽调整规则优先级。按从上到下的顺序依次匹配。
                  </div>
                  
                  <draggable v-model="px.proxyRules" item-key="pattern" handle=".drag-handle" animation="200" ghost-class="ghost">
                    <template #item="{ element: rule, index: rIdx }">
                      <div class="flex items-center gap-3 p-2 mb-2 bg-gray-50 border border-gray-200 rounded-md shadow-sm relative group">
                        <el-icon class="drag-handle cursor-move text-gray-400 hover:text-blue-500" :size="20"><Sort /></el-icon>
                        <el-input v-model="rule.pattern" size="small" placeholder="匹配模式 (*.google.com)" class="flex-1" />
                        <el-select v-model="rule.action" size="small" class="w-48">
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
                        <el-button type="danger" link :icon="Delete" @click="px.proxyRules.splice(rIdx, 1)" class="opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </template>
                  </draggable>

                  <el-empty v-if="!px.proxyRules || px.proxyRules.length === 0" description="暂无规则，将执行下方默认动作" :image-size="40" />

                  <div class="mt-4 flex items-center justify-end gap-2 bg-blue-50 border border-blue-100 p-2 rounded">
                    <el-tooltip content="当以上所有规则都没有命中时，流量将执行此动作。" placement="top">
                      <el-icon class="text-gray-400"><InfoFilled /></el-icon>
                    </el-tooltip>
                    <span class="text-xs font-bold text-gray-700">默认兜底动作:</span>
                    <el-select v-model="px.defaultRuleAction" size="small" style="width: 180px;">
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


              </el-collapse-item>
            </el-collapse>

            <div class="flex items-center gap-1 mt-4 mb-1">
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
            <el-input v-model="px._allowIps" type="textarea" :rows="1" placeholder="白名单 (每行一个 IP)" class="mb-1" />
            <el-input v-model="px._denyIps" type="textarea" :rows="1" placeholder="黑名单 (每行一个 IP)" class="mb-3" />

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
            <el-input v-model="px._targetAllowIps" type="textarea" :rows="1" placeholder="目标白名单 (建议使用上方的分流规则表)" class="mb-1" />
            <el-input v-model="px._targetDenyIps" type="textarea" :rows="1" placeholder="目标黑名单 (建议使用上方的分流规则表)" />
          </el-form>
        </el-card>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import draggable from 'vuedraggable';
import { Delete, Plus, User, Lock, Switch, HelpFilled, InfoFilled, Sort } from '@element-plus/icons-vue';

const props = defineProps({
  mode: String,
  title: String,
  config: Object,
  status: Object,
  availableIps: {
    type: Array,
    default: () => ['0.0.0.0', '127.0.0.1']
  }
});

const emit = defineEmits(['start', 'stop']);

const sectionConfig = computed(() => {
  return props.mode === 'server' ? props.config.server : props.config.client;
});

const isRunning = computed(() => {
  return props.mode === 'server' ? props.status.serverRunning : props.status.clientRunning;
});

const addForward = () => {
  if (!sectionConfig.value.forwards) sectionConfig.value.forwards = [];
  sectionConfig.value.forwards.push({ listenPort: 8080, targetHost: '127.0.0.1', targetPort: 80 });
};

const addProxy = () => {
  if (!sectionConfig.value.proxies) sectionConfig.value.proxies = [];
  sectionConfig.value.proxies.push({
    listenPort: 1080,
    listenIp: '0.0.0.0',
    isSystemProxy: false,
    useAuth: false,
    user: '',
    pass: '',
    useRemoteNetwork: true,
    _allowIps: '',
    _denyIps: '',
    _targetAllowIps: '',
    _targetDenyIps: '',
    proxyRules: [],
    chainNodes: [],
    defaultRuleAction: 'proxy_chain'
  });
};

const addRule = (px) => {
  if (!px.proxyRules) px.proxyRules = [];
  px.proxyRules.push({ pattern: '', action: 'direct_local' });
};


const toggleSystemProxy = async (px) => {
  try {
    if (px.isSystemProxy) {
      // First turn off any other proxies that might have this flag on
      sectionConfig.value.proxies.forEach(p => {
        if (p !== px) p.isSystemProxy = false;
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
