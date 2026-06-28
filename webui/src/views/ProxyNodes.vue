<template>
  <div class="space-y-6">
    <div class="flex flex-col gap-4 sticky top-[60px] z-10 bg-white dark:bg-gray-900 pb-4 -mx-6 px-6 pt-4 -mt-4">
      <div class="flex justify-between items-center bt-section-status">
        <div class="flex items-center gap-3">
          <el-icon :size="24" style="color: var(--bt-primary)"><Monitor /></el-icon>
          <span class="font-bold text-lg bt-text">{{ t('nodes.title') }}</span>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <div class="flex items-center gap-2">
            <el-input v-model="testTargetLatency" :placeholder="t('nodes.testLatencyTarget')" class="w-48" size="small" />
            <el-button type="warning" plain :icon="Connection" size="small" @click="testAllLatency">{{ testingAllLatency ? t('common.cancel') : t('nodes.testAllLatency') }}</el-button>
          </div>
          <div class="flex items-center gap-2">
            <el-input v-model="testTargetSpeed" :placeholder="t('nodes.testSpeedTarget')" class="w-48" size="small" />
            <el-button type="success" plain :icon="Odometer" size="small" @click="testAllSpeed">{{ testingAllSpeed ? t('common.cancel') : t('nodes.testAllSpeed') }}</el-button>
          </div>
          <el-button type="primary" plain :icon="Plus" @click="createGroup" size="small">{{ t('nodes.newGroup') }}</el-button>
          <el-button type="danger" plain :icon="Delete" size="small" @click="openCleanDialog">{{ t('nodes.cleanDeadNodes') }}</el-button>
          <el-button type="primary" :icon="Plus" @click="openImportDialog">{{ t('nodes.addOrImport') }}</el-button>
        </div>
      </div>

      <div class="flex justify-between items-center bg-gray-50/5 p-3 rounded-lg border border-gray-100 dark:border-gray-800">
        <div class="flex items-center gap-4 flex-1">
          <el-input v-model="searchQuery" :placeholder="t('nodes.searchPlaceholder')" :prefix-icon="Search" class="w-64" clearable />
        </div>
        <div class="text-sm text-gray-500 font-medium">{{ t('nodes.totalCount', { count: config.proxyNodes?.length || 0 }) }}</div>
      </div>
    </div>

    <el-empty v-if="Object.keys(groupedNodes).length === 0" :description="t('nodes.empty')" :image-size="80" />

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
                <el-popconfirm :title="t('nodes.deleteNodeConfirm')" @confirm="deleteNode(node.id)">
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
                  <span class="text-gray-500 w-12">{{ t('nodes.urlLabel') }}:</span>
                  <span class="font-mono text-gray-600 truncate flex-1">********</span>
                </div>
                <div class="flex items-center gap-2 text-sm">
                  <span class="text-gray-500 w-12">{{ t('nodes.statusLabel') }}:</span>
                  <el-tag size="small" type="success" effect="plain"><el-icon class="mr-1"><Check /></el-icon>{{ t('nodes.parseSuccess') }}</el-tag>
                </div>
              </template>

              <template v-else>
                <div class="flex items-center gap-2 mb-2">
                  <span class="text-gray-500 text-sm w-12">{{ t('nodes.addressLabel') }}:</span>
                  <el-input v-model="node.host" size="small" class="flex-1" :placeholder="t('nodes.addressPlaceholder')" />
                  <span class="text-gray-400">:</span>
                  <el-input-number v-model="node.port" size="small" :min="1" :max="65535" :controls="false" class="w-20" :placeholder="t('nodes.portPlaceholder')" />
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-gray-500 text-sm w-12">{{ t('nodes.authLabel') }}:</span>
                  <el-input v-model="node.user" size="small" :placeholder="t('nodes.usernamePlaceholder')" class="flex-1" />
                  <el-input v-model="node.pass" size="small" :placeholder="t('nodes.passwordPlaceholder')" show-password class="flex-1" />
                </div>
              </template>
            </div>

            <!-- Metrics Section -->
            <div class="flex items-center gap-4 mb-3 text-xs p-2 rounded border" style="border-color: var(--bt-border); background: var(--bt-input-bg);">
              <div class="flex items-center gap-1 flex-1">
                <el-icon :class="getLatencyColor(node._latency)"><Clock /></el-icon>
                <span class="text-gray-500">{{ t('nodes.latencyLabel') }}:</span>
                <span class="font-bold font-mono" :class="getLatencyColor(node._latency)">{{ node._latency ? node._latency + ' ms' : '--' }}</span>
              </div>
              <div class="flex items-center gap-1 flex-1">
                <el-icon :class="getSpeedColor(node._speed)"><Odometer /></el-icon>
                <span class="text-gray-500">{{ t('nodes.speedLabel') }}:</span>
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
                  @click="testLatency(node.id)"
                >
                  {{ testingNode === node.id ? t('common.cancel') : t('nodes.testLatencyBtn') }}
                </el-button>
                <el-button
                  type="success"
                  link
                  size="small"
                  :icon="Odometer"
                  @click="testSpeed(node.id)"
                >
                  {{ testingSpeedNode === node.id ? t('common.cancel') : t('nodes.testSpeedBtn') }}
                </el-button>
              </div>
            </div>
          </el-card>
        </div>
      </div>
    </div>

    <!-- Share Dialog -->
    <el-dialog v-model="shareDialogVisible" :title="t('nodes.shareTitle')" width="400px" center destroy-on-close>
      <div class="flex flex-col items-center justify-center gap-4 p-4">
        <h3 class="font-bold text-lg text-center">{{ shareNode?.displayName }}</h3>
        <div class="p-2 bg-white rounded-lg shadow-sm border border-gray-100">
          <QrcodeVue v-if="shareNodeUrl" :value="shareNodeUrl" :size="200" level="M" />
        </div>
        <el-button type="primary" @click="copyNodeLink" :icon="DocumentCopy" class="mt-4 w-full">{{ t('nodes.copyNodeLink') }}</el-button>
      </div>
    </el-dialog>

    <!-- Import / Add Node Dialog -->
    <el-dialog v-model="importDialogVisible" :title="t('nodes.importTitle')" width="50%" destroy-on-close>
      <el-tabs v-model="importTab" class="mt-[-10px]">
        <el-tab-pane :label="t('nodes.textImportTab')" name="text">
          <div class="mb-2 text-sm text-gray-500">
            {{ t('nodes.textImportHint') }}
          </div>
          <el-input v-model="importText" type="textarea" :rows="8" :placeholder="t('nodes.textImportPlaceholder')" />
          <div class="mt-4 flex justify-between">
            <el-button @click="readClipboard" :icon="DocumentCopy">{{ t('nodes.readClipboard') }}</el-button>
            <el-button type="primary" @click="doImportText" :icon="Check">{{ t('nodes.parseAndImport') }}</el-button>
          </div>
        </el-tab-pane>

        <el-tab-pane :label="t('nodes.qrImportTab')" name="qr">
          <div class="flex flex-col items-center justify-center py-8 gap-4 border-2 border-dashed rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <el-icon class="text-gray-400" :size="48"><FullScreen /></el-icon>
            <div class="text-sm text-gray-500">{{ t('nodes.qrHint') }}</div>
            <input type="file" accept="image/*" class="hidden" ref="fileInput" @change="handleQRUpload" />
            <el-button type="primary" @click="$refs.fileInput.click()">{{ t('nodes.selectImage') }}</el-button>
          </div>
          <div v-if="qrResult" class="mt-4 p-3 bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-md border border-green-200 dark:border-green-800 text-sm">
            <div class="font-bold mb-1">{{ t('nodes.qrSuccessTitle') }}</div>
            <div class="truncate opacity-75 font-mono">{{ qrResult }}</div>
          </div>
        </el-tab-pane>

        <el-tab-pane :label="t('nodes.manualTab')" name="manual">
          <el-form label-width="80px">
            <el-form-item :label="t('nodes.nameLabel')">
              <el-input v-model="manualForm.displayName" :placeholder="t('nodes.namePlaceholder')" />
            </el-form-item>
            <el-form-item :label="t('nodes.protocolType')">
              <el-radio-group v-model="manualForm.type">
                <el-radio-button value="socks5">SOCKS5</el-radio-button>
                <el-radio-button value="http">HTTP</el-radio-button>
                <el-radio-button value="vmess">VMess</el-radio-button>
                <el-radio-button value="vless">VLESS</el-radio-button>
                <el-radio-button value="trojan">Trojan</el-radio-button>
                <el-radio-button value="shadowsocks">SS</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item :label="t('nodes.serverLabel')">
              <el-input v-model="manualForm.host" :placeholder="t('nodes.serverPlaceholder')" />
            </el-form-item>
            <el-form-item :label="t('nodes.portLabel')">
              <el-input-number v-model="manualForm.port" :min="1" :max="65535" class="w-full" />
            </el-form-item>

            <!-- SOCKS5 / HTTP 字段 -->
            <template v-if="manualForm.type === 'socks5' || manualForm.type === 'http'">
              <el-form-item :label="t('nodes.usernameLabel')">
                <el-input v-model="manualForm.user" :placeholder="t('nodes.optionalPlaceholder')" />
              </el-form-item>
              <el-form-item :label="t('nodes.passwordLabel')">
                <el-input v-model="manualForm.pass" type="password" show-password :placeholder="t('nodes.optionalPlaceholder')" />
              </el-form-item>
              <el-form-item v-if="manualForm.type === 'http'" :label="t('nodes.tlsLabel')">
                <el-switch v-model="manualForm.tls" />
                <span class="text-xs text-gray-500 ml-2">{{ t('nodes.tlsHint') }}</span>
              </el-form-item>
              <el-form-item v-if="manualForm.type === 'http' && manualForm.tls" :label="t('nodes.sniLabel')">
                <el-input v-model="manualForm.sni" :placeholder="t('nodes.sniPlaceholder')" />
                <span class="text-xs text-gray-500 ml-2">{{ t('nodes.sniHint') }}</span>
              </el-form-item>
            </template>

            <!-- v2ray 字段（VMess / VLESS / Trojan / SS） -->
            <template v-else>
              <el-form-item :label="t('nodes.uuidLabel')">
                <el-input v-model="manualForm.uuid" :placeholder="t('nodes.uuidPlaceholder')" />
              </el-form-item>
              <el-form-item :label="t('nodes.transportLabel')">
                <el-select v-model="manualForm.network" class="w-full">
                  <el-option label="TCP" value="tcp" />
                  <el-option label="WebSocket (WS)" value="ws" />
                  <el-option label="gRPC" value="grpc" />
                </el-select>
              </el-form-item>
              <el-form-item v-if="manualForm.network !== 'tcp'" :label="t('nodes.pathLabel')">
                <el-input v-model="manualForm.path" :placeholder="t('nodes.pathPlaceholder')" />
              </el-form-item>
              <el-form-item :label="t('nodes.securityConfig')">
                <el-select v-model="manualForm.v2rayTls" class="w-full">
                  <el-option :label="t('nodes.securityNone')" value="none" />
                  <el-option :label="t('nodes.securityTls')" value="tls" />
                  <el-option :label="t('nodes.securityReality')" value="reality" />
                </el-select>
              </el-form-item>
              <el-form-item v-if="manualForm.v2rayTls !== 'none'" :label="t('nodes.sniLabel')">
                <el-input v-model="manualForm.sni" :placeholder="t('nodes.sniPlaceholder')" />
              </el-form-item>
            </template>

            <el-form-item :label="t('nodes.groupLabel')">
              <el-select v-model="manualForm.group" allow-create filterable default-first-option :placeholder="t('nodes.groupPlaceholder')" class="w-full">
                <el-option v-for="g in allGroups" :key="g" :label="g" :value="g" />
              </el-select>
            </el-form-item>
          </el-form>
          <div class="flex justify-end mt-4">
            <el-button type="primary" @click="doAddManual" :icon="Check">{{ t('nodes.addToPool') }}</el-button>
          </div>
        </el-tab-pane>

        <el-tab-pane :label="t('nodes.subImportTab')" name="sub">
          <div class="mb-4 text-sm text-gray-500">
            {{ t('nodes.subHint') }}
          </div>
          <el-form label-width="80px" class="mb-4 bg-gray-50 dark:bg-gray-800 p-4 rounded-md">
            <el-form-item :label="t('nodes.subUrlLabel')" class="mb-3">
              <el-input v-model="subUrl" type="textarea" :rows="3" :placeholder="t('nodes.subUrlPlaceholder')" />
            </el-form-item>
            <div class="grid grid-cols-2 gap-4">
              <el-form-item :label="t('nodes.configNameLabel')" class="mb-0">
                <el-input v-model="subName" :placeholder="t('nodes.configNamePlaceholder')" size="small" />
              </el-form-item>
              <el-form-item :label="t('nodes.subGroupLabel')" class="mb-0">
                <el-select v-model="subGroup" allow-create filterable default-first-option :placeholder="t('nodes.subGroupPlaceholder')" class="w-full" size="small">
                  <el-option v-for="g in allGroups" :key="g" :label="g" :value="g" />
                </el-select>
              </el-form-item>
            </div>
          </el-form>
          <div class="flex justify-end mb-4">
            <el-button type="primary" :loading="fetchingSub" @click="fetchSubscription" class="w-32">{{ t('nodes.fetchNodes') }}</el-button>
          </div>
          <div v-if="subNodes.length > 0" class="border rounded-md p-2 h-64 overflow-y-auto mb-4" style="background: var(--bt-surface); border-color: var(--bt-border);">
            <el-checkbox-group v-model="selectedSubNodes">
              <div v-for="(node, idx) in subNodes" :key="idx" class="mb-2 last:mb-0">
                <el-checkbox :label="node">
                  <span class="font-bold mr-2">{{ node.displayName }}</span>
                  <span class="text-xs text-gray-500">{{ node.type }} - {{ node.host }}:{{ node.port }} ({{ t('nodes.groupLabel') }}: {{ node.group }})</span>
                </el-checkbox>
              </div>
            </el-checkbox-group>
          </div>
          <div class="flex justify-between items-center" v-if="subNodes.length > 0">
            <div class="text-sm">
              {{ t('nodes.subSelectedCount', { selected: selectedSubNodes.length, total: subNodes.length }) }}
              <el-button link type="primary" @click="selectAllSubNodes">{{ t('nodes.selectAll') }}</el-button>
            </div>
            <el-button type="success" :disabled="selectedSubNodes.length === 0" @click="importSubNodes">{{ t('nodes.importSelected') }}</el-button>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-dialog>

    <!-- V2Ray Edit Dialog -->
    <el-dialog v-model="v2rayEditDialogVisible" :title="t('nodes.v2rayEditTitle')" width="500px" destroy-on-close>
      <el-form label-width="100px" size="small" class="mt-4">
        <el-form-item :label="t('nodes.displayName')">
          <el-input v-model="v2rayEditForm.displayName" />
        </el-form-item>
        <el-form-item :label="t('nodes.serverField')">
          <el-input v-model="v2rayEditForm.host" />
        </el-form-item>
        <el-form-item :label="t('nodes.portField')">
          <el-input-number v-model="v2rayEditForm.port" :min="1" :max="65535" class="w-full" />
        </el-form-item>
        <el-form-item :label="t('nodes.uuidLabel')">
          <el-input v-model="v2rayEditForm.uuid" :placeholder="t('nodes.uuidPlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('nodes.transportLabel')">
          <el-select v-model="v2rayEditForm.network" class="w-full">
            <el-option label="TCP" value="tcp" />
            <el-option label="WebSocket (WS)" value="ws" />
            <el-option label="gRPC" value="grpc" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('nodes.pathLabel')" v-if="v2rayEditForm.network !== 'tcp'">
          <el-input v-model="v2rayEditForm.path" :placeholder="t('nodes.pathPlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('nodes.securityConfig')">
          <el-select v-model="v2rayEditForm.tls" class="w-full">
            <el-option :label="t('nodes.securityNone')" value="none" />
            <el-option :label="t('nodes.securityTls')" value="tls" />
            <el-option :label="t('nodes.securityReality')" value="reality" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('nodes.sniLabel')" v-if="v2rayEditForm.tls !== 'none'">
          <el-input v-model="v2rayEditForm.sni" :placeholder="t('nodes.sniPlaceholder')" />
        </el-form-item>
      </el-form>
      <div class="flex justify-end mt-4">
        <el-button @click="v2rayEditDialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="saveV2rayEditor">{{ t('nodes.saveAndUpdate') }}</el-button>
      </div>
    </el-dialog>

    <!-- Clean Dead Nodes Dialog -->
    <el-dialog v-model="cleanDialogVisible" :title="t('nodes.cleanTitle')" width="550px" destroy-on-close>
      <div v-if="cleanState === 'idle'" class="text-center py-6">
        <el-icon :size="48" class="text-blue-500 mb-4"><Monitor /></el-icon>
        <p class="text-base mb-6 bt-text">{{ t('nodes.cleanIntro') }}</p>
        <el-button type="primary" size="large" @click="startCleanTest">{{ t('nodes.startScan') }}</el-button>
      </div>

      <div v-else-if="cleanState === 'testing'" class="py-6 space-y-4">
        <div class="flex justify-between items-center text-sm bt-text">
          <span>{{ t('nodes.cleanTesting') }}: <strong>{{ cleanCurrentNode }}</strong></span>
          <span v-if="cleanCanceled" class="text-red-500">{{ t('nodes.cleanCanceling') }}</span>
        </div>
        <el-progress :percentage="cleanProgress" :status="cleanCanceled ? 'exception' : ''" />
        <div class="flex justify-between items-center mt-4">
          <span class="text-xs text-gray-500">{{ t('nodes.cleanFound', { count: cleanFailedNodes.length }) }}</span>
          <el-button type="danger" plain size="small" @click="cancelCleanTest" :disabled="cleanCanceled">{{ t('nodes.cancelScan') }}</el-button>
        </div>
      </div>

      <div v-else-if="cleanState === 'done'" class="space-y-4">
        <el-alert v-if="cleanFailedNodes.length === 0" :title="t('nodes.scanComplete')" type="success" :description="t('nodes.scanHealthy')" show-icon :closable="false" />
        <div v-else>
          <el-alert :title="t('nodes.scanComplete')" type="warning" :description="t('nodes.scanFoundFailed', { count: cleanFailedNodes.length })" show-icon :closable="false" class="mb-4" />

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
            <el-button @click="cleanDialogVisible = false">{{ t('common.cancel') }}</el-button>
            <el-button type="danger" @click="confirmCleanNodes" :disabled="cleanSelectedNodeIds.length === 0">{{ t('nodes.deleteSelected', { count: cleanSelectedNodeIds.length }) }}</el-button>
          </div>
        </div>
        <div v-if="cleanFailedNodes.length === 0" class="flex justify-end mt-4">
          <el-button @click="cleanDialogVisible = false">{{ t('nodes.close') }}</el-button>
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
import { t } from '../i18n';

const props = defineProps({
  config: Object
});

const generateId = () => Math.random().toString(36).substr(2, 9);

const importDialogVisible = ref(false);
const importTab = ref('text');
const importText = ref('');
const manualForm = ref({ displayName: '', type: 'socks5', host: '', port: 1080, user: '', pass: '', tls: false, sni: '', uuid: '', network: 'tcp', path: '', v2rayTls: 'none', group: 'default' });
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
    const { value } = await ElMessageBox.prompt(t('nodes.groupCreatePrompt'), t('nodes.groupCreateTitle'), {
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel'),
      inputPattern: /\S+/,
      inputErrorMessage: t('nodes.groupNameRequired')
    });
    if (value) {
      if (!props.config.proxyGroups) props.config.proxyGroups = [];
      if (!props.config.proxyGroups.includes(value)) {
        props.config.proxyGroups.push(value);
        ElMessage.success(t('nodes.groupCreated', { name: value }));
      } else {
        ElMessage.warning(t('nodes.groupExists'));
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
  // HTTP 节点启用 TLS 时，把 tls=1 和 sni 写进查询参数，便于分享
  let query = '';
  if (node.type === 'http' && node.tls) {
    const params = new URLSearchParams();
    params.set('tls', '1');
    if (node.sni) params.set('sni', node.sni);
    query = '?' + params.toString();
  }
  return `${node.type}://${auth}${node.host}:${node.port}${query}#${encodeURIComponent(node.displayName)}`;
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
    ElMessage.success(t('nodes.nodeLinkCopied'));
    shareDialogVisible.value = false;
  } catch(e) {
    ElMessage.error(t('nodes.copyFailed'));
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
        ElMessage.success(t('nodes.qrSuccess'));
        setTimeout(() => {
          importTab.value = 'text';
          qrResult.value = '';
        }, 1500);
      } else {
        ElMessage.error(t('nodes.qrNoMatch'));
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  event.target.value = ''; // reset
};

const fetchSubscription = async () => {
  if (!subUrl.value) return ElMessage.warning(t('nodes.subUrlRequired'));
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
      ElMessage.success(t('nodes.subParsed', { count: data.nodes.length }));
      if (data.errors) {
        ElMessage.warning(t('nodes.subPartialFailed', { errors: data.errors.join(', ') }));
      }
    } else {
      ElMessage.error(data.message || t('common.failed'));
    }
  } catch(e) {
    ElMessage.error(t('nodes.requestFailed'));
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
  ElMessage.success(t('nodes.subImported', { count }));
  importDialogVisible.value = false;
};

const v2rayEditDialogVisible = ref(false);
const v2rayEditForm = ref({});
const v2rayEditingNodeId = ref(null);

const openV2rayEditor = (node) => {
  const decoded = decodeV2RayUrl(node.rawUrl);
  if (!decoded) {
    ElMessage.error(t('nodes.v2rayParseError'));
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
    ElMessage.error(t('nodes.v2rayGenerateError'));
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

  ElMessage.success(t('nodes.v2rayUpdated'));
  v2rayEditDialogVisible.value = false;
};

const openImportDialog = () => {
  importText.value = '';
  manualForm.value = { displayName: t('nodes.defaultManualName'), type: 'socks5', host: '', port: 1080, user: '', pass: '', tls: false, sni: '', uuid: '', network: 'tcp', path: '', v2rayTls: 'none', group: 'default' };
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

// 用于支持"再次点击取消"的 AbortController 映射
const abortControllers = ref({}); // key: `${type}:${nodeId}` 或 `${type}:all`

const testLatency = async (nodeId, silent = false) => {
  // 如果正在测试中，则取消
  const key = `latency:${nodeId}`;
  if (testingNode.value === nodeId) {
    const ac = abortControllers.value[key];
    if (ac) { ac.abort(); delete abortControllers.value[key]; }
    testingNode.value = null;
    if (!silent) ElMessage.info(t('nodes.latencyCanceled'));
    return;
  }
  testingNode.value = nodeId;
  const controller = new AbortController();
  abortControllers.value[key] = controller;
  try {
    const parts = testTargetLatency.value.split(':');
    const targetHost = parts[0] || 'www.bing.com';
    const targetPort = parseInt(parts[1]) || 443;

    const res = await fetch('/api/test-latency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'node', id: nodeId, targetHost, targetPort }),
      signal: controller.signal
    });
    const data = await res.json();
    const node = props.config.proxyNodes.find(n => n.id === nodeId);
    
    if (data.success) {
      if (node) node._latency = data.latency;
      if (!silent) ElMessage.success(t('nodes.testLatencySuccess', { latency: data.latency }));
    } else {
      if (node) node._latency = null;
      if (!silent) ElMessage.error(t('nodes.testLatencyFailed', { msg: data.message }));
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      if (!silent) ElMessage.info(t('nodes.latencyCanceled'));
    } else {
      if (!silent) ElMessage.error(t('nodes.requestFailed'));
    }
  } finally {
    if (testingNode.value === nodeId) testingNode.value = null;
    delete abortControllers.value[key];
  }
};

const testSpeed = async (nodeId, silent = false) => {
  // 如果正在测速中，则取消
  const key = `speed:${nodeId}`;
  if (testingSpeedNode.value === nodeId) {
    const ac = abortControllers.value[key];
    if (ac) { ac.abort(); delete abortControllers.value[key]; }
    testingSpeedNode.value = null;
    if (!silent) ElMessage.info(t('nodes.speedCanceled'));
    return;
  }
  testingSpeedNode.value = nodeId;
  const controller = new AbortController();
  abortControllers.value[key] = controller;
  try {
    const parts = testTargetSpeed.value.split(':');
    const targetHost = parts[0] || 'speed.cloudflare.com';
    const targetPort = parseInt(parts[1]) || 443;

    const res = await fetch('/api/test-speed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'node', id: nodeId, targetHost, targetPort }),
      signal: controller.signal
    });
    const data = await res.json();
    const node = props.config.proxyNodes.find(n => n.id === nodeId);

    if (data.success) {
      if (node) node._speed = data.speed;
      if (!silent) ElMessage.success(t('nodes.testSpeedSuccess', { speed: data.speed }));
    } else {
      if (node) node._speed = null;
      if (!silent) ElMessage.error(t('nodes.testSpeedFailed', { msg: data.message }));
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      if (!silent) ElMessage.info(t('nodes.speedCanceled'));
    } else {
      if (!silent) ElMessage.error(t('nodes.requestFailed'));
    }
  } finally {
    if (testingSpeedNode.value === nodeId) testingSpeedNode.value = null;
    delete abortControllers.value[key];
  }
};

const testAllLatency = async () => {
  // 如果正在全部测试中，则取消
  if (testingAllLatency.value) {
    Object.keys(abortControllers.value).forEach(k => {
      if (k.startsWith('latency:')) {
        abortControllers.value[k].abort();
        delete abortControllers.value[k];
      }
    });
    testingAllLatency.value = false;
    testingNode.value = null;
    ElMessage.info(t('nodes.cancelAllLatency'));
    return;
  }
  if (!props.config.proxyNodes || props.config.proxyNodes.length === 0) return;
  testingAllLatency.value = true;
  ElMessage.info(t('nodes.startAllLatency'));
  const promises = props.config.proxyNodes.map(n => testLatency(n.id, true));
  await Promise.allSettled(promises);
  if (testingAllLatency.value) {
    testingAllLatency.value = false;
    ElMessage.success(t('nodes.allLatencyComplete'));
  }
};

const testAllSpeed = async () => {
  // 如果正在全部测速中，则取消
  if (testingAllSpeed.value) {
    Object.keys(abortControllers.value).forEach(k => {
      if (k.startsWith('speed:')) {
        abortControllers.value[k].abort();
        delete abortControllers.value[k];
      }
    });
    testingAllSpeed.value = false;
    testingSpeedNode.value = null;
    ElMessage.info(t('nodes.cancelAllSpeed'));
    return;
  }
  if (!props.config.proxyNodes || props.config.proxyNodes.length === 0) return;
  testingAllSpeed.value = true;
  ElMessage.info(t('nodes.startAllSpeed'));
  const promises = props.config.proxyNodes.map(n => testSpeed(n.id, true));
  await Promise.all(promises);
  if (testingAllSpeed.value) {
    testingAllSpeed.value = false;
    ElMessage.success(t('nodes.allSpeedComplete'));
  }
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
  ElMessage.success(t('nodes.deletedCount', { count: cleanSelectedNodeIds.value.length }));
};

const readClipboard = async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      importText.value = (importText.value ? importText.value + '\n' : '') + text;
      ElMessage.success(t('nodes.clipboardAppended'));
    } else {
      ElMessage.warning(t('nodes.clipboardEmpty'));
    }
  } catch (err) {
    ElMessage.error(t('nodes.clipboardError'));
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
          pass: parsed.pass,
          tls: !!parsed.tls,
          sni: parsed.sni || ''
        });
        imported++;
      }
    }
  }
  
  if (imported > 0) {
    ElMessage.success(t('nodes.importedCount', { count: imported }));
    importDialogVisible.value = false;
  } else {
    ElMessage.warning(t('nodes.noValidLinks'));
  }
};

const doAddManual = () => {
  if (!manualForm.value.host || !manualForm.value.port) {
    ElMessage.warning(t('nodes.hostPortRequired'));
    return;
  }
  const f = manualForm.value;
  const isV2ray = ['vmess', 'vless', 'trojan', 'shadowsocks'].includes(f.type);

  if (!props.config.proxyNodes) props.config.proxyNodes = [];

  if (isV2ray) {
    // v2ray 节点必须有 UUID
    if (!f.uuid) {
      ElMessage.warning(t('nodes.uuidRequired'));
      return;
    }
    // 通过 encodeV2RayUrl 生成 rawUrl，与订阅/文本导入保持一致
    const rawUrl = encodeV2RayUrl({
      v2rayType: f.type,
      displayName: f.displayName || `${f.type.toUpperCase()} ${f.host}:${f.port}`,
      host: f.host,
      port: f.port,
      uuid: f.uuid,
      network: f.network || 'tcp',
      path: f.path || '',
      tls: f.v2rayTls || 'none',
      sni: f.sni || ''
    });
    if (!rawUrl) {
      ElMessage.error(t('nodes.v2rayGenerateError'));
      return;
    }
    props.config.proxyNodes.push({
      id: 'node_' + generateId(),
      displayName: f.displayName || `${f.type.toUpperCase()} ${f.host}:${f.port}`,
      group: f.group || 'default',
      type: 'v2ray',
      v2rayType: f.type,
      rawUrl
    });
  } else {
    // SOCKS5 / HTTP 直接平铺字段
    props.config.proxyNodes.push({
      id: 'node_' + generateId(),
      ...f
    });
  }
  ElMessage.success(t('nodes.nodeAdded'));
  importDialogVisible.value = false;
};
</script>

<style scoped>
</style>
