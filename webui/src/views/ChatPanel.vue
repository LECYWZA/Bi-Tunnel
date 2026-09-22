<template>
  <div class="chat-page">
    <div class="chat-layout">
      <!-- 消息区: 上下两个方向卡片 -->
      <div class="chat-message-panel">
        <!-- 卡片1: 作为服务端 -> 客户端 -->
        <div class="chat-dir-card">
          <div class="chat-panel-header">
            <el-tag size="small" type="primary" effect="plain">服务端</el-tag>
            <span class="dir-title">作为服务端 → 客户端</span>
            <el-select
              v-model="serverTargetId"
              size="small"
              style="width: 170px;"
              placeholder="选择目标客户端"
            >
              <el-option label="全部在线客户端" value="" />
              <el-option
                v-for="c in knownClients"
                :key="c.id"
                :label="clientLabel(c, true)"
                :value="c.id"
              />
            </el-select>
            <el-button size="small" :icon="Upload" :loading="sending.server" @click="fileInput['server'].click()">
              发文件
            </el-button>
            <input ref="fileInputServer" type="file" class="hidden-input" @change="onFileChange($event, 'server')" />
          </div>
          <div ref="msgListServer" class="chat-msg-list">
            <div v-if="serverMsgs.length === 0" class="chat-empty small">无消息</div>
            <div
              v-for="m in reversed(serverMsgs)"
              :key="m.id"
              :class="['chat-bubble-row', m.dir === 'out' ? 'chat-row-out' : 'chat-row-in']"
            >
              <div :class="['chat-bubble', m.dir === 'out' ? 'chat-bubble-out' : 'chat-bubble-in']">
                <div class="chat-bubble-meta">
                  <span class="chat-bubble-from">{{ m.dir === 'out' ? '我' : (m.from || '客户端') }}</span>
                  <span class="chat-bubble-time">{{ fmtTime(m.ts) }}</span>
                </div>
                <div class="chat-bubble-text">{{ m.text }}</div>
              </div>
            </div>
          </div>
          <div class="chat-input-row">
            <el-input
              v-model="draft.server"
              type="textarea"
              :rows="1"
              resize="none"
              placeholder="向客户端发消息 (Enter 发送)"
              @keydown="onInputKeydown($event, 'server')"
            />
            <el-button
              type="primary"
              :icon="Promotion"
              :loading="sending.server"
              :disabled="!draft.server.trim()"
              @click="sendMessage('server')"
            >
              发送
            </el-button>
          </div>
        </div>

        <!-- 卡片2: 作为客户端 -> 服务端 -->
        <div class="chat-dir-card">
          <div class="chat-panel-header">
            <el-tag size="small" type="success" effect="plain">客户端</el-tag>
            <span class="dir-title">作为客户端 → 服务端</span>
            <el-select
              v-model="clientTargetId"
              size="small"
              style="width: 170px;"
              placeholder="选择目标服务端"
            >
              <el-option label="全部在线服务端连接" value="" />
              <el-option
                v-for="c in serverConnections"
                :key="c.id"
                :label="clientLabel(c, false)"
                :value="c.id"
              />
            </el-select>
            <el-button size="small" :icon="Upload" :loading="sending.client" @click="fileInput['client'].click()">
              发文件
            </el-button>
            <input ref="fileInputClient" type="file" class="hidden-input" @change="onFileChange($event, 'client')" />
          </div>
          <div ref="msgListClient" class="chat-msg-list">
            <div v-if="clientMsgs.length === 0" class="chat-empty small">无消息</div>
            <div
              v-for="m in reversed(clientMsgs)"
              :key="m.id"
              :class="['chat-bubble-row', m.dir === 'out' ? 'chat-row-out' : 'chat-row-in']"
            >
              <div :class="['chat-bubble', m.dir === 'out' ? 'chat-bubble-out' : 'chat-bubble-in']">
                <div class="chat-bubble-meta">
                  <span class="chat-bubble-from">{{ m.dir === 'out' ? '我' : (m.from || '服务端') }}</span>
                  <span class="chat-bubble-time">{{ fmtTime(m.ts) }}</span>
                </div>
                <div class="chat-bubble-text">{{ m.text }}</div>
              </div>
            </div>
          </div>
          <div class="chat-input-row">
            <el-input
              v-model="draft.client"
              type="textarea"
              :rows="1"
              resize="none"
              placeholder="向服务端发消息 (Enter 发送)"
              @keydown="onInputKeydown($event, 'client')"
            />
            <el-button
              type="success"
              :icon="Promotion"
              :loading="sending.client"
              :disabled="!draft.client.trim()"
              @click="sendMessage('client')"
            >
              发送
            </el-button>
          </div>
        </div>
      </div>

      <!-- 文件传输区 -->
      <div class="chat-file-panel">
        <div class="chat-panel-header">
          <span class="font-bold">文件传输</span>
          <el-button size="small" :icon="Refresh" @click="refreshAll" plain>刷新</el-button>
        </div>

        <div class="chat-file-section-title">上传进度</div>
        <div class="chat-file-list">
          <div v-if="uploadFiles.length === 0" class="chat-empty small">暂无上传</div>
          <div v-for="f in uploadFiles" :key="f.id" class="transfer-item">
            <div class="transfer-info">
              <div class="transfer-name">{{ f.name }} <el-tag size="small" :type="f.direction === 'server' ? 'primary' : 'success'" effect="plain">{{ f.direction === 'server' ? '→客户端' : '→服务端' }}</el-tag></div>
              <el-progress :percentage="f.percent" :status="f.percent >= 100 ? 'success' : undefined" />
            </div>
          </div>
        </div>

        <div class="chat-file-section-title">传输记录</div>
        <div class="chat-file-list">
          <div v-if="transfers.length === 0" class="chat-empty small">暂无传输</div>
          <div v-for="tr in transfers" :key="tr.id" class="transfer-item">
            <el-icon :size="16" :color="tr.dir === 'out' ? 'var(--el-color-primary)' : 'var(--el-color-success)'">
              <Upload v-if="tr.dir === 'out'" />
              <Download v-else />
            </el-icon>
            <div class="transfer-info">
              <div class="transfer-name" :title="tr.name">{{ tr.name }}</div>
              <div class="transfer-meta">
                {{ tr.dir === 'out' ? '发送' : '接收' }} · {{ fmtSize(tr.size) }}
                <el-tag v-if="tr.via" size="small" :type="tr.via === 'server' ? 'primary' : 'success'" effect="plain" style="margin-left:4px;">
                  {{ tr.via === 'server' ? '服务端方向' : '客户端方向' }}
                </el-tag>
                <span v-if="tr.done"> · 完成</span>
                <span v-else-if="tr.progress && tr.total"> · {{ Math.round(tr.progress / tr.total * 100) }}%</span>
              </div>
            </div>
          </div>
        </div>

        <div class="chat-file-section-title">已接收文件 (files/)</div>
        <div class="chat-file-list">
          <div v-if="receivedFiles.length === 0" class="chat-empty small">暂无文件</div>
          <div v-for="f in receivedFiles" :key="f.name" class="transfer-item">
            <el-icon :size="16" color="var(--bt-text-sec)"><Document /></el-icon>
            <div class="transfer-info">
              <div class="transfer-name" :title="f.name">{{ f.name }}</div>
              <div class="transfer-meta">{{ fmtSize(f.size) }} · {{ fmtTime(f.mtime) }}</div>
            </div>
            <el-button link size="small" :icon="Download" title="下载" @click="downloadFile(f.name)" />
            <el-button link size="small" type="danger" :icon="Delete" title="删除" @click="deleteFile(f.name)" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, nextTick, onUnmounted, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { ChatDotRound, Promotion, Refresh, Upload, Download, Document, Delete } from '@element-plus/icons-vue';
import { inject } from 'vue';

const t = inject('t');
const authFetch = inject('authFetch');
const onChatEvent = inject('onChatEvent');

const props = defineProps({
  config: { type: Object, default: () => ({}) },
  status: { type: Object, default: () => ({}) }
});

const messages = ref([]);
const transfers = ref([]);
const receivedFiles = ref([]);
const draft = reactive({ server: '', client: '' });
const sending = reactive({ server: false, client: false });
const serverTargetId = ref('');
const clientTargetId = ref('');
const uploadFiles = ref([]);
const msgListServer = ref(null);
const msgListClient = ref(null);
const fileInputServer = ref(null);
const fileInputClient = ref(null);
const fileInput = computed(() => ({ server: fileInputServer, client: fileInputClient }));
let unregister = null;

const knownClients = computed(() => {
  const cs = props.config?.server?.knownClients || [];
  const online = new Set(props.status?.connectedClients || []);
  return cs.map(c => ({ ...c, online: online.has(c.id) }));
});

const serverConnections = computed(() => {
  const cs = Array.isArray(props.config?.client?.connections) ? props.config.client.connections : [];
  const st = new Map(Array.isArray(props.status?.clientConnections) ? props.status.clientConnections.map(c => [c.id, c.status]) : []);
  return cs.map(c => ({ ...c, online: (st.get(c.id) || '') === 'connected' }));
});

const clientLabel = (c, asServer) => {
  const name = c.name || c.alias || c.id || '节点';
  return c.online ? `${name} (在线)` : `${name} (离线)`;
};

const serverMsgs = computed(() => messages.value.filter(m => (m.via || 'server') === 'server'));
const clientMsgs = computed(() => messages.value.filter(m => (m.via || '') === 'client'));

const reversed = (list) => list.slice().reverse();

const fmtTime = (ts) => {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch (e) {
    return '';
  }
};

const fmtSize = (bytes) => {
  if (bytes === undefined || bytes === null) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
};

const scrollToBottom = async (which) => {
  await nextTick();
  const el = which === 'client' ? msgListClient.value : msgListServer.value;
  if (el) el.scrollTop = el.scrollHeight;
};

const pushMessage = (m) => {
  const idx = messages.value.findIndex(x => x.id === m.id);
  if (idx >= 0) {
    messages.value[idx] = m;
  } else {
    messages.value.push(m);
    if (messages.value.length > 500) {
      messages.value.splice(0, messages.value.length - 500);
    }
  }
  scrollToBottom(m.via === 'client' ? 'client' : 'server');
};

const upsertTransfer = (rec) => {
  const idx = transfers.value.findIndex(t => t.id === rec.id);
  if (idx >= 0) {
    transfers.value[idx] = { ...transfers.value[idx], ...rec };
  } else {
    transfers.value.unshift({ ...rec, progress: rec.progress || 0 });
  }
};

async function loadHistory() {
  try {
    const res = await authFetch('/api/chat/history');
    const data = await res.json();
    if (data.success) {
      messages.value = (data.messages || []).slice(-500);
      const recs = data.files || [];
      transfers.value = recs.map(r => ({ ...r, done: true })).reverse();
      scrollToBottom('server');
      scrollToBottom('client');
    }
  } catch (e) {
    console.error('Load chat history failed:', e);
  }
}

async function loadFiles() {
  try {
    const res = await authFetch('/api/files');
    const data = await res.json();
    if (data.success) {
      receivedFiles.value = data.files || [];
    }
  } catch (e) {
    console.error('Load files failed:', e);
  }
}

async function refreshAll() {
  await loadHistory();
  await loadFiles();
}

const sendMessage = async (direction) => {
  const text = draft[direction].trim();
  if (!text) return;
  sending[direction] = true;
  try {
    const tid = direction === 'server' ? serverTargetId.value : clientTargetId.value;
    const res = await authFetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, targetClientId: tid, direction })
    });
    const data = await res.json();
    if (data.success) {
      draft[direction] = '';
    } else {
      ElMessage.error(data.message || '发送失败');
    }
  } catch (e) {
    ElMessage.error('请求失败: ' + e.message);
  } finally {
    sending[direction] = false;
  }
};

const onInputKeydown = (e, direction) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage(direction);
  }
};

const onFileChange = async (e, direction) => {
  const raw = e.target.files && e.target.files[0];
  if (!raw) return;
  const item = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: raw.name,
    direction,
    percent: 0
  };
  uploadFiles.value.push(item);
  sending[direction] = true;
  try {
    const params = new URLSearchParams({ name: raw.name, direction });
    const tid = direction === 'server' ? serverTargetId.value : clientTargetId.value;
    if (tid) params.set('targetClientId', tid);
    const res = await authFetch('/api/file/send?' + params.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: raw
    });
    const data = await res.json();
    if (data.success) {
      item.percent = 100;
      ElMessage.success(`文件 ${raw.name} 已发送`);
    } else {
      ElMessage.error(data.message || '文件发送失败');
      item.percent = 0;
    }
  } catch (err) {
    ElMessage.error('文件发送失败: ' + err.message);
    item.percent = 0;
  } finally {
    sending[direction] = false;
    e.target.value = '';
    setTimeout(() => {
      uploadFiles.value = uploadFiles.value.filter(u => u !== item);
    }, 3000);
  }
};

const downloadFile = (name) => {
  window.open('/api/files/' + encodeURIComponent(name), '_blank');
};

const deleteFile = async (name) => {
  try {
    const res = await authFetch('/api/files/' + encodeURIComponent(name), { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      receivedFiles.value = receivedFiles.value.filter(f => f.name !== name);
      ElMessage.success('已删除');
    } else {
      ElMessage.error(data.message || '删除失败');
    }
  } catch (e) {
    ElMessage.error('请求失败: ' + e.message);
  }
};

onMounted(async () => {
  await loadHistory();
  await loadFiles();
  if (onChatEvent) {
    unregister = onChatEvent((evt) => {
      if (evt.type === 'chat_msg') {
        pushMessage(evt.data);
        // 只滚动对应卡片
        scrollToBottom((evt.data || {}).via === 'client' ? 'client' : 'server');
      } else if (evt.type === 'file_received') {
        upsertTransfer({ ...evt.data, done: true });
        loadFiles();
        ElMessage.success(`收到文件: ${evt.data.name}`);
      } else if (evt.type === 'file_sent') {
        upsertTransfer({ ...evt.data, done: true });
      } else if (evt.type === 'file_progress') {
        const p = evt.data;
        const idx = transfers.value.findIndex(t => t.id === p.id);
        if (idx >= 0) {
          const cur = transfers.value[idx];
          transfers.value[idx] = { ...cur, progress: p.dir === 'out' ? p.sent : p.received, total: p.total, done: p.dir === 'out' ? (p.sent >= p.total) : (p.received >= p.total) };
        } else {
          upsertTransfer({
            id: p.id,
            name: p.name,
            size: p.total,
            dir: p.dir,
            progress: p.dir === 'out' ? p.sent : p.received,
            total: p.total
          });
        }
      }
    });
  }
});

onUnmounted(() => {
  if (unregister) unregister();
});
</script>

<style scoped>
.chat-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.chat-layout {
  display: flex;
  gap: 16px;
  flex: 1;
  min-height: 0;
}
.chat-message-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.chat-dir-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-bg-color);
}
.chat-file-panel {
  width: 340px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-bg-color);
  padding-bottom: 8px;
}
.hidden-input {
  display: none;
}
.chat-panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  flex-wrap: wrap;
}
.dir-title {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
.chat-msg-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 12px;
}
.chat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  color: var(--bt-text-sec);
  font-size: 13px;
}
.chat-empty.small {
  height: 48px;
}
.chat-bubble-row {
  display: flex;
  margin-bottom: 8px;
}
.chat-row-out {
  justify-content: flex-end;
}
.chat-row-in {
  justify-content: flex-start;
}
.chat-bubble {
  max-width: 72%;
  border-radius: 8px;
  padding: 6px 10px;
  word-break: break-word;
}
.chat-bubble-out {
  background: var(--el-color-primary);
  color: #fff;
}
.chat-bubble-in {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}
.chat-bubble-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
  opacity: 0.75;
  margin-bottom: 2px;
}
.chat-bubble-text {
  font-size: 14px;
  white-space: pre-wrap;
}
.chat-input-row {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--el-border-color-lighter);
  align-items: flex-end;
}
.chat-file-section-title {
  padding: 8px 12px 4px;
  font-size: 12px;
  color: var(--bt-text-sec);
}
.chat-file-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 12px 8px;
}
.transfer-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  border-bottom: 1px dashed var(--el-border-color-lighter);
}
.transfer-info {
  flex: 1;
  min-width: 0;
}
.transfer-name {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.transfer-meta {
  font-size: 11px;
  color: var(--bt-text-sec);
}
</style>
