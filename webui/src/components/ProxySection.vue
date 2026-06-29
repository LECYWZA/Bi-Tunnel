<template>
  <div>
    <div class="space-y-6">
    <div class="flex justify-between items-center bt-section-status sticky top-[60px] z-10 bg-white dark:bg-gray-900 -mx-6 px-6 pt-4 -mt-4 pb-4">
      <div class="flex items-center gap-3">
        <el-icon :size="24" class="text-purple-500"><HelpFilled /></el-icon>
        <span class="font-bold text-lg bt-text">{{ t('proxies.title') }}</span>
      </div>
      <el-dropdown @command="handleAddProxy">
        <el-button type="primary" plain size="small" :icon="Plus">
          {{ t('proxies.addProxy') }}<el-icon class="el-icon--right"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="server">{{ t('proxies.addServerProxy') }}</el-dropdown-item>
            <el-dropdown-item command="client">{{ t('proxies.addClientProxy') }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <el-empty v-if="allProxies.length === 0" :description="t('proxies.empty')" :image-size="80" />

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6" v-else>
      <el-card v-for="(item, index) in allProxies" :key="index" shadow="hover" class="bt-card h-full transition-transform hover:-translate-y-1" body-class="flex flex-col h-full">
          <div class="flex justify-between items-center mb-2 pb-2" style="border-bottom: 1px solid var(--bt-border);">
            <div class="flex items-center gap-2">
              <el-radio-group :model-value="item._mode" size="small" @change="(newMode) => switchProxyMode(item._mode, newMode, item._ref)">
                <el-radio-button value="server">{{ t('proxies.serverProxy') }}</el-radio-button>
                <el-radio-button value="client">{{ t('proxies.clientProxy') }}</el-radio-button>
              </el-radio-group>
            </div>

            <div class="flex items-center gap-2">
              <el-switch v-model="item._ref.enabled" inline-prompt :active-text="t('proxies.enabledSwitch')" :inactive-text="t('proxies.disabledSwitch')" @change="toggleProxyEnabled(item._ref)" />
              <el-button type="danger" circle plain :icon="Delete" size="small" @click="removeProxy(item._mode, item._ref)" />
            </div>
          </div>

          <el-form label-position="top">
            <el-row :gutter="16">
              <el-col :span="24">
                <el-form-item class="mb-2">
                  <template #label>
                    <div class="flex items-center gap-1">
                      <span>{{ t('proxies.name') }}</span>
                      <el-tooltip :content="t('proxies.nameTooltip')" placement="top">
                        <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                      </el-tooltip>
                    </div>
                  </template>
                  <el-input v-model="item._ref.name" :placeholder="t('proxies.namePlaceholder')" @blur="handleNameBlur(item._ref)" />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item class="mb-2">
                  <template #label>
                    <div class="flex items-center gap-1">
                      <span>{{ t('proxies.listenPort') }}</span>
                      <el-tooltip :content="t('proxies.listenPortTooltip')" placement="top">
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
                      <span>{{ t('proxies.listenIp') }}</span>
                      <el-tooltip :content="t('proxies.listenIpTooltip')" placement="top">
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
            </el-row>

            <div class="p-3 rounded my-3" style="background: var(--bt-surface); border: 1px solid var(--bt-border);">
              <div class="flex justify-between items-center mb-2">
                <div class="flex items-center gap-1">
                  <span class="font-bold text-gray-700 text-sm">{{ t('proxies.auth') }}</span>
                  <el-tooltip :content="t('proxies.authTooltip')" placement="top">
                    <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
                  </el-tooltip>
                </div>
                <el-switch v-model="item._ref.useAuth" />
              </div>
              <el-collapse-transition>
                <div v-show="item._ref.useAuth">
                  <div v-if="!item._ref.users || item._ref.users.length === 0" class="mb-2">
                    <el-button size="small" plain @click="ensureUsers(item._ref)">{{ t('proxies.setupAccount') }}</el-button>
                  </div>
                  <div v-else>
                    <div v-for="(u, idx) in item._ref.users" :key="idx" class="flex gap-2 items-center mb-2">
                      <el-input v-model="u.user" :placeholder="t('proxies.username')" :prefix-icon="User" size="small" />
                      <el-input v-model="u.pass" :placeholder="t('proxies.password')" show-password :prefix-icon="Lock" size="small" />
                      <el-button type="danger" link :icon="Delete" @click="item._ref.users.splice(idx, 1)" />
                    </div>
                    <el-button type="primary" link size="small" :icon="Plus" @click="item._ref.users.push({user:'', pass:''})">{{ t('proxies.addAccount') }}</el-button>
                  </div>
                </div>
              </el-collapse-transition>
            </div>

            <div class="mt-4 pt-4 flex items-center justify-between" style="border-top: 1px dashed var(--bt-border);">
              <div class="flex items-center gap-2 text-sm text-gray-500">
                <el-icon><Guide /></el-icon>
                <span>{{ t('proxies.advancedPolicy') }}</span>
              </div>
              <div class="flex gap-2">
                <el-button type="primary" plain :icon="Setting" size="small" @click="openRoutingDialog(item._ref, item._mode)">{{ t('proxies.routingRules') }}</el-button>
                <el-button type="warning" plain :icon="Setting" size="small" @click="openAclDialog(item._ref, item._mode)">{{ t('proxies.acl') }}</el-button>
              </div>
            </div>
          </el-form>
        </el-card>
      </div>
    </div>
  </div>

  <!-- Advanced Routing Dialog -->
  <el-dialog v-model="routingDialogVisible" :title="t('proxies.routingDialog')" width="60%" destroy-on-close>
    <div v-if="currentProxy">
      <div class="mb-5 p-4 rounded-md" style="background: var(--bt-surface); border: 1px solid var(--bt-border);">
        <div class="flex justify-between items-center mb-3">
          <div class="flex items-center gap-1">
            <span class="font-bold text-sm bt-text">{{ t('proxies.routingTable') }}</span>
            <el-tooltip effect="dark" placement="top" style="max-width: 300px;">
              <template #content>
                <span v-html="t('proxies.routingTableTooltip')"></span>
              </template>
              <el-icon class="text-gray-400 cursor-pointer"><InfoFilled /></el-icon>
            </el-tooltip>
          </div>
          <el-button type="primary" plain size="small" :icon="Plus" @click="addRule(currentProxy)">{{ t('proxies.addRule') }}</el-button>
        </div>

        <div class="text-xs bt-text-secondary mb-2 flex items-center gap-1">
          <el-icon><InfoFilled /></el-icon> {{ t('proxies.dragHint') }}
        </div>

        <draggable v-model="currentProxy.proxyRules" item-key="id" handle=".drag-handle" animation="300" ghost-class="ghost">
          <template #item="{ element: rule, index: rIdx }">
            <div class="flex items-center gap-3 p-3 mb-3 rounded-md relative group" style="background: var(--bt-input-bg); border: 1px solid var(--bt-border);">
              <el-icon class="drag-handle cursor-move bt-text-secondary hover:text-blue-500 transition-colors" :size="20"><Sort /></el-icon>

              <div class="flex-1 grid grid-cols-[1fr_auto_auto_1fr] gap-4 items-start">
                <!-- Rule Cards Selector and List -->
                <div class="flex flex-col gap-2 p-2 rounded" style="background: var(--bt-surface); border: 1px solid var(--bt-border);">
                  <div class="flex flex-col gap-1.5 mb-1">
                    <span class="text-xs font-bold bt-text-secondary whitespace-nowrap">{{ t('proxies.ruleCards') }}</span>
                    <el-select
                      :model-value="''"
                      :placeholder="t('proxies.addRuleCard')"
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
                    {{ t('proxies.noRuleCards') }}
                  </div>
                </div>

                <!-- Network Mode Selector (本地/远端网络) -->
                <div class="flex flex-col gap-2 p-2 rounded min-w-[140px]" style="background: var(--bt-surface); border: 1px solid var(--bt-border);">
                  <div class="flex flex-col gap-1.5">
                    <span class="text-xs font-bold bt-text-secondary whitespace-nowrap">{{ t('rules.networkMode') }}</span>
                    <el-select v-model="rule.networkMode" size="small" class="w-full" @change="(val) => { if (val !== 'remote') rule.targetClientId = ''; }">
                      <el-option :label="t('rules.networkLocal')" value="local" />
                      <el-option :label="t('rules.networkRemote')" value="remote" />
                    </el-select>
                  </div>
                  <div v-if="rule.networkMode === 'remote'" class="flex flex-col gap-1.5">
                    <span class="text-xs font-bold bt-text-secondary whitespace-nowrap">
                      {{ currentProxyMode === 'server' ? t('proxies.targetClientId') : t('proxies.carrierServer') }}
                    </span>
                    <el-select v-if="currentProxyMode === 'client'" v-model="rule.targetClientId" :placeholder="t('proxies.carrierServerPlaceholder')" size="small" class="w-full" filterable>
                      <el-option v-for="c in (config.client.connections || [])" :key="c.id" :label="c.alias" :value="c.id" />
                    </el-select>
                    <el-select v-else v-model="rule.targetClientId" :placeholder="t('proxies.targetClientIdPlaceholder')" size="small" class="w-full" filterable>
                      <el-option v-for="c in (config.server.knownClients || [])" :key="c.id" :label="`${c.id}${c.online ? ' (' + t('proxies.clientOnline') + ')' : ''}`" :value="c.id" />
                    </el-select>
                  </div>
                </div>

                <el-icon class="text-gray-400 mt-3"><Right /></el-icon>

                <!-- Route Action Selector and List -->
                <div class="flex flex-col gap-2 p-2 rounded" style="background: var(--bt-surface); border: 1px solid var(--bt-border);">
                  <div class="flex flex-col gap-1.5 mb-1">
                    <span class="text-xs font-bold bt-text-secondary whitespace-nowrap">{{ t('proxies.forwardTargets') }}</span>
                    <el-select
                      :model-value="''"
                      :placeholder="t('proxies.addForwardTarget')"
                      class="w-full"
                      filterable
                      @change="(val) => addActionToRule(rule, val)"
                    >
                      <el-option-group :label="t('proxies.builtinActions')">
                        <el-option :label="t('rules.actionDirectLocal')" value="direct_local" :disabled="rule.action?.includes('direct_local')" />
                        <el-option :label="t('rules.actionDirectRemote')" value="direct_remote" :disabled="rule.action?.includes('direct_remote')" />
                        <el-option :label="t('rules.actionBlock')" value="block" :disabled="rule.action?.includes('block')" />
                      </el-option-group>
                      <el-option-group :label="t('chains.title')" v-if="config.proxyChains && config.proxyChains.length">
                        <el-option v-for="chain in config.proxyChains" :key="chain.id" :label="chain.name" :value="`chain:${chain.id}`" :disabled="rule.action?.includes(`chain:${chain.id}`)" />
                      </el-option-group>
                      <el-option-group :label="t('nodes.title')" v-if="config.proxyNodes && config.proxyNodes.length">
                        <el-option v-for="node in config.proxyNodes" :key="node.id" :label="node.displayName" :value="`node:${node.id}`" :disabled="rule.action?.includes(`node:${node.id}`)" />
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
                    {{ t('proxies.noForwardTargets') }}
                  </div>
                </div>
              </div>

              <el-button type="danger" link :icon="Delete" @click="currentProxy.proxyRules.splice(rIdx, 1)" class="opacity-0 group-hover:opacity-100 transition-opacity ml-2" />
            </div>
          </template>
        </draggable>

        <el-empty v-if="!currentProxy.proxyRules || currentProxy.proxyRules.length === 0" :description="t('proxies.noRules')" :image-size="40" />

        <!-- Default Fallback Actions List -->
        <div class="mt-4 p-3 rounded flex flex-col gap-3" style="background: var(--bt-input-bg); border: 1px solid var(--bt-border);">
          <div class="flex justify-between items-center gap-4">
            <div class="flex items-center gap-1.5 shrink-0">
              <el-tooltip :content="t('proxies.defaultActionTooltip')" placement="top">
                <el-icon class="text-gray-400"><InfoFilled /></el-icon>
              </el-tooltip>
              <span class="text-xs font-bold bt-text whitespace-nowrap">{{ t('proxies.defaultFallbackAction') }}</span>
            </div>
            <el-select
              :model-value="''"
              :placeholder="t('proxies.addFallbackAction')"
              class="w-64"
              filterable
              @change="(val) => addDefaultAction(currentProxy, val)"
            >
              <el-option-group :label="t('proxies.builtinActions')">
                <el-option :label="t('rules.actionDirectLocal')" value="direct_local" :disabled="currentProxy.defaultRuleActions?.some(it => it.action === 'direct_local')" />
                <el-option :label="t('rules.actionDirectRemote')" value="direct_remote" :disabled="currentProxy.defaultRuleActions?.some(it => it.action === 'direct_remote')" />
                <el-option :label="t('rules.actionBlock')" value="block" :disabled="currentProxy.defaultRuleActions?.some(it => it.action === 'block')" />
              </el-option-group>
              <el-option-group :label="t('chains.title')" v-if="config.proxyChains && config.proxyChains.length">
                <el-option v-for="chain in config.proxyChains" :key="chain.id" :label="chain.name" :value="`chain:${chain.id}`" :disabled="currentProxy.defaultRuleActions?.some(it => it.action === `chain:${chain.id}`)" />
              </el-option-group>
              <el-option-group :label="t('nodes.title')" v-if="config.proxyNodes && config.proxyNodes.length">
                <el-option v-for="node in config.proxyNodes" :key="node.id" :label="node.displayName" :value="`node:${node.id}`" :disabled="currentProxy.defaultRuleActions?.some(it => it.action === `node:${node.id}`)" />
              </el-option-group>
            </el-select>
          </div>

          <draggable v-model="currentProxy.defaultRuleActions" item-key="action" handle=".default-action-drag" animation="200" ghost-class="ghost" class="flex flex-col gap-2">
            <template #item="{ element: item, index: dIdx }">
              <div class="flex items-center gap-2 p-1.5 rounded text-xs flex-wrap" style="background: var(--bt-surface); border: 1px solid var(--bt-border);">
                <el-icon class="default-action-drag cursor-move bt-text-secondary" :size="14"><Sort /></el-icon>
                <el-tag size="small" :type="getActionTagType(item.action)" effect="dark">{{ getActionName(item.action) }}</el-tag>
                <template v-if="actionNeedsNetworkMode(item.action)">
                  <el-select v-model="item.networkMode" size="small" style="width: 110px;" @change="(val) => { if (val !== 'remote') item.targetClientId = ''; }">
                    <el-option :label="t('rules.networkLocal')" value="local" />
                    <el-option :label="t('rules.networkRemote')" value="remote" />
                  </el-select>
                  <template v-if="item.networkMode === 'remote'">
                    <el-select v-if="currentProxyMode === 'client'" v-model="item.targetClientId" :placeholder="t('proxies.carrierServerPlaceholder')" size="small" style="width: 140px;" filterable>
                      <el-option v-for="c in (config.client.connections || [])" :key="c.id" :label="c.alias" :value="c.id" />
                    </el-select>
                    <el-select v-else v-model="item.targetClientId" :placeholder="t('proxies.targetClientIdPlaceholder')" size="small" style="width: 140px;" filterable>
                      <el-option v-for="c in (config.server.knownClients || [])" :key="c.id" :label="`${c.id}${c.online ? ' (' + t('proxies.clientOnline') + ')' : ''}`" :value="c.id" />
                    </el-select>
                  </template>
                </template>
                <el-button type="danger" link :icon="Delete" size="small" @click="currentProxy.defaultRuleActions.splice(dIdx, 1)" />
              </div>
            </template>
          </draggable>
          <div v-if="!currentProxy.defaultRuleActions || currentProxy.defaultRuleActions.length === 0" class="text-center text-xs bt-text-muted py-1">
            {{ t('proxies.noFallbackAction') }}
          </div>
        </div>
      </div>
    </div>
  </el-dialog>

  <!-- ACL Dialog -->
  <el-dialog v-model="aclDialogVisible" :title="t('proxies.acl')" width="800px" destroy-on-close>
    <div v-if="currentProxy">
      <div class="flex items-center gap-1 mb-1">
        <span class="font-bold text-xs text-gray-700">{{ t('proxies.sourceIpControl') }}</span>
        <el-tooltip effect="dark" placement="top" style="max-width: 300px;">
          <template #content>
            <span v-html="t('proxies.sourceIpTooltip')"></span>
          </template>
          <el-icon class="text-gray-400 cursor-pointer text-xs"><InfoFilled /></el-icon>
        </el-tooltip>
      </div>
      <el-input v-model="currentProxy._allowIps" type="textarea" :rows="3" :placeholder="t('proxies.whitelistPlaceholder')" class="mb-2" />
      <el-input v-model="currentProxy._denyIps" type="textarea" :rows="3" :placeholder="t('proxies.blacklistPlaceholder')" class="mb-4" />

      <div class="flex items-center gap-1 mb-1">
        <span class="font-bold text-xs text-gray-700">{{ t('proxies.targetIpControl') }}</span>
        <el-tooltip effect="dark" placement="top" style="max-width: 300px;">
          <template #content>
            <span v-html="t('proxies.targetIpTooltip')"></span>
          </template>
          <el-icon class="text-gray-400 cursor-pointer text-xs"><InfoFilled /></el-icon>
        </el-tooltip>
      </div>
      <el-input v-model="currentProxy._targetAllowIps" type="textarea" :rows="3" :placeholder="t('proxies.targetWhitelistPlaceholder')" class="mb-2" />
      <el-input v-model="currentProxy._targetDenyIps" type="textarea" :rows="3" :placeholder="t('proxies.targetBlacklistPlaceholder')" />
    </div>
    </el-dialog>
</template>

<script setup>
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import draggable from 'vuedraggable';
import { Delete, Plus, User, Lock, Switch, HelpFilled, InfoFilled, Sort, Right, Setting, Guide, ArrowDown } from '@element-plus/icons-vue';
import { t } from '../i18n';

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
const currentProxyMode = ref('server');

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

// 收集所有模式（server+client）中已占用的本地端口，用于即时冲突预检
// onlyEnabled=true 时只收集已启用的规则端口（用于启用前严格预检）
const getUsedPorts = (excludeObj, onlyEnabled = false) => {
  const used = new Map(); // port -> label
  const isOccupied = (item) => onlyEnabled ? (item.enabled !== false && item.listenPort) : item.listenPort;
  const collect = (modeCfg, modeLabel) => {
    if (!modeCfg) return;
    if (modeCfg.forwards) {
      modeCfg.forwards.forEach((f, i) => {
        if (f !== excludeObj && isOccupied(f)) {
          used.set(f.listenPort, `${modeLabel}${t('forward.forwardUnit')}#${i + 1}`);
        }
      });
    }
    if (modeCfg.connections) {
      modeCfg.connections.forEach((c, i) => {
        if (c !== excludeObj && isOccupied(c)) {
          used.set(c.listenPort, `${modeLabel}${t('forward.connUnit')}#${i + 1}(${c.alias || c.id})`);
        }
      });
    }
  };
  collect(props.config.server, t('proxies.serverLabel'));
  collect(props.config.client, t('proxies.clientLabel'));
  const collectProxies = (modeCfg, modeLabel) => {
    if (modeCfg && modeCfg.proxies) {
      modeCfg.proxies.forEach((p, i) => {
        if (p !== excludeObj && isOccupied(p)) {
          used.set(p.listenPort, `${modeLabel}${t('proxies.proxyUnit')}#${i + 1}(${p.name || ''})`);
        }
      });
    }
  };
  collectProxies(props.config.server, t('proxies.serverLabel'));
  collectProxies(props.config.client, t('proxies.clientLabel'));
  return used;
};

// 收集所有代理（server+client）的名称集合，用于名称去重
const getAllProxyNames = (excludeObj) => {
  const names = new Set();
  const collect = (modeCfg) => {
    if (modeCfg && modeCfg.proxies) {
      modeCfg.proxies.forEach(p => {
        if (p !== excludeObj && p.name) names.add(p.name);
      });
    }
  };
  collect(props.config.server);
  collect(props.config.client);
  return names;
};

// 生成唯一代理 ID
const genProxyId = () => `proxy_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 6)}`;

const handleAddProxy = (mode) => {
  if (!props.config[mode].proxies) props.config[mode].proxies = [];

  // 收集所有已占用的端口（服务端+客户端的代理/映射/连接），避免端口冲突
  const usedPorts = getUsedPorts(null);

  // 从 1080 开始寻找未占用的端口
  let newPort = 1080;
  while (usedPorts.has(newPort)) newPort++;

  // 统计当前模式下同名代理的数量，生成默认名称
  const modeLabel = mode === 'server' ? t('proxies.serverLabel') : t('proxies.clientLabel');
  const sameModeCount = props.config[mode].proxies.length + 1;
  let defaultName = `${modeLabel}${t('proxies.proxyUnit')} ${sameModeCount}`;

  // 名称去重：若名称已存在，则追加 "_重复"，直到唯一
  const existingNames = getAllProxyNames(null);
  if (existingNames.has(defaultName)) {
    defaultName = defaultName + t('common.duplicateSuffix');
  }

  props.config[mode].proxies.push({
    id: genProxyId(),
    name: defaultName,
    enabled: false,
    listenPort: newPort,
    listenIp: '0.0.0.0',
    isSystemProxy: false,
    useAuth: false,
    users: [{ user: '', pass: '' }],
    _allowIps: '',
    _denyIps: '',
    _targetAllowIps: '',
    _targetDenyIps: '',
    proxyRules: [],
    chainNodes: [],
    defaultRuleActions: [{ action: 'direct_local', networkMode: 'local', targetClientId: '' }]
  });
};

// 代理启用开关切换：启用前预检端口冲突（前端配置冲突 + 后端实际占用），冲突则回滚为禁用
const toggleProxyEnabled = async (px) => {
  if (!px.enabled) return; // 关闭无需校验
  // 1) 前端预检：检查是否与其他已启用的代理/映射/连接端口冲突
  const used = getUsedPorts(px, true);
  if (used.has(px.listenPort)) {
    ElMessage.error(t('proxies.portInUse', { port: px.listenPort, name: used.get(px.listenPort) }));
    px.enabled = false;
    return;
  }
  // 2) 后端校验：检查端口是否被系统其他进程占用
  try {
    const res = await fetch(`/api/check-port/${px.listenPort}`);
    const data = await res.json();
    if (data.success && !data.available) {
      ElMessage.error(data.message || t('proxies.portOccupied', { port: px.listenPort }));
      px.enabled = false;
    }
  } catch (e) {
    // 后端校验失败不阻断，依赖代理服务启动时的错误兜底
    console.error('Port check failed:', e);
  }
};

// 名称编辑失焦校验：若与其他代理重名，自动追加 "_重复"
const handleNameBlur = (px) => {
  const name = (px.name || '').trim();
  if (!name) return;
  const others = getAllProxyNames(px);
  if (others.has(name)) {
    let newName = name + t('common.duplicateSuffix');
    while (others.has(newName)) newName = newName + t('common.duplicateSuffix');
    px.name = newName;
    ElMessage.warning(t('proxies.nameAutoChanged', { name: newName }));
  }
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
    ElMessage.success(newMode === 'server' ? t('proxies.switchedToServer') : t('proxies.switchedToClient'));
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

const openRoutingDialog = (px, mode) => {
  currentProxy.value = px;
  currentProxyMode.value = mode || 'server';
  routingDialogVisible.value = true;
};

const openAclDialog = (px, mode) => {
  currentProxy.value = px;
  currentProxyMode.value = mode || 'server';
  aclDialogVisible.value = true;
};

const addRule = (px) => {
  if (!props.config.ruleCards || props.config.ruleCards.length === 0) {
    ElMessage.warning(t('proxies.noRuleCardsWarning'));
    return;
  }
  if (!px.proxyRules) px.proxyRules = [];
  const defaultCardId = props.config.ruleCards[0].id;
  px.proxyRules.push({ id: Math.random().toString(36).substr(2, 9), ruleCardIds: [defaultCardId], action: ['direct_local'], networkMode: 'local', targetClientId: '' });
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
  if (act === 'direct_local') return t('rules.actionDirectLocal');
  if (act === 'direct_remote') return t('rules.actionDirectRemote');
  if (act === 'block') return t('rules.actionBlock');
  if (act.startsWith('chain:')) {
    const chainId = act.substring(6);
    const chain = (props.config.proxyChains || []).find(c => c.id === chainId);
    return chain ? chain.name : t('rules.chainLabel', { id: chainId });
  }
  if (act.startsWith('node:')) {
    const nodeId = act.substring(5);
    const node = (props.config.proxyNodes || []).find(n => n.id === nodeId);
    return node ? node.displayName : t('rules.nodeLabel', { id: nodeId });
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
  if (!proxy.defaultRuleActions) {
    proxy.defaultRuleActions = [];
  }
  // 已存在同 action 的项则不重复添加
  if (!proxy.defaultRuleActions.some(it => it.action === val)) {
    proxy.defaultRuleActions.push({ action: val, networkMode: 'local', targetClientId: '' });
  }
};

// 判断动作是否需要网络模式选择(代理链/节点需要;直连/拦截不需要,因为 direct_local/direct_remote/block 本身已定义网络行为)
const actionNeedsNetworkMode = (act) => {
  return act.startsWith('chain:') || act.startsWith('node:') || act === 'proxy_chain';
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
