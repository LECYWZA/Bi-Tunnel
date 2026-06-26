<template>
  <div class="space-y-6">
    <div class="flex justify-between items-center bt-section-status">
      <div class="flex flex-col">
        <div class="flex items-center gap-2">
          <el-icon style="color: var(--bt-primary)"><Odometer /></el-icon>
          <span class="font-bold text-lg bt-text">代理测试台</span>
        </div>
        <span class="text-xs bt-text-muted mt-1">您可以在这里保存多组代理配置进行交叉测试。配置将自动保存在您的浏览器中。</span>
      </div>
      <el-button type="primary" :icon="Plus" @click="addProfile" shadow>
        添加测试配置
      </el-button>
    </div>

    <el-empty v-if="profiles.length === 0" description="暂无测试配置，请点击右上角添加" :image-size="80" />

    <div class="grid grid-cols-1 xl:grid-cols-2 gap-6" v-if="profiles.length > 0">
      <el-card v-for="(profile, index) in profiles" :key="String(profile.id)" shadow="hover" class="bt-card h-full" body-class="flex flex-col h-full p-5">
        
        <div class="flex justify-between items-center mb-5 pb-4" style="border-bottom: 1px solid var(--bt-border);">
          <div class="flex items-center gap-3 flex-1">
            <span class="font-bold bt-text text-lg">测试配置</span>
            <el-input v-model="profile.name" placeholder="配置名称" size="small" class="w-48" @change="saveProfiles" />
          </div>
          <div class="flex gap-2 items-center">
            <el-button type="primary" plain :icon="CopyDocument" size="small" @click="copyProxyUrl(profile)">复制链接</el-button>
            <el-button type="danger" plain :icon="Delete" size="small" @click="removeProfile(index)">删除</el-button>
          </div>
        </div>

        <el-form label-position="top" size="default" class="flex-1">
          <el-row :gutter="20">
            <el-col :xs="24" :sm="12">
              <el-form-item label="代理协议">
                <el-select v-model="profile.type" class="w-full" @change="saveProfiles">
                  <el-option label="HTTP / HTTPS 代理" value="http" />
                  <el-option label="SOCKS5 代理" value="socks5" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="代理服务器 IP">
                <el-input v-model="profile.host" placeholder="例如: 127.0.0.1" @change="saveProfiles" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="代理服务器端口">
                <el-input-number v-model="profile.port" :min="1" :max="65535" class="w-full" controls-position="right" @change="saveProfiles" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="目标测试网址">
                <el-input v-model="profile.targetUrl" placeholder="例如: https://cn.bing.com" @change="saveProfiles" />
              </el-form-item>
            </el-col>
          </el-row>

          <div class="p-4 rounded-lg mb-4" style="background: var(--bt-input-bg); border: 1px solid var(--bt-border);">
            <el-row :gutter="20">
              <el-col :xs="24" :sm="12">
                <el-form-item label="代理用户名 (可选)" class="mb-0">
                  <el-input v-model="profile.username" placeholder="留空表示无密码" :prefix-icon="User" @change="saveProfiles" />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="12">
                <el-form-item label="代理密码 (可选)" class="mb-0 mt-4 sm:mt-0">
                  <el-input v-model="profile.password" placeholder="留空表示无密码" show-password :prefix-icon="Lock" @change="saveProfiles" />
                </el-form-item>
              </el-col>
            </el-row>
          </div>

          <div class="flex justify-end mt-2 gap-2">
            <el-button 
              v-if="profile.testing"
              type="danger" 
              size="default" 
              :icon="CircleClose" 
              @click="cancelTest(profile)" 
              class="px-6 font-bold"
            >
              取消测试
            </el-button>
            <el-button 
              v-else
              type="success" 
              size="default" 
              :icon="VideoPlay" 
              @click="runTest(profile)" 
              class="px-8 font-bold"
            >
              ⚡ 开始测试
            </el-button>
          </div>
        </el-form>

        <div v-if="profile.logs && profile.logs.length > 0" class="mt-5 rounded-lg overflow-hidden" style="border: 1px solid var(--bt-border);">
          <div class="flex justify-between items-center p-3" style="background: var(--bt-input-bg); border-bottom: 1px solid var(--bt-border);">
            <span class="font-mono text-xs flex items-center gap-2 bt-text-secondary">
              <el-icon><Monitor /></el-icon> 日志输出
            </span>
            <el-tag 
              :type="profile.testResult === true ? 'success' : (profile.testResult === false ? 'danger' : 'warning')" 
              effect="dark" 
              size="small"
            >
              {{ profile.testResult === true ? '✅ 测试成功' : (profile.testResult === false ? '❌ 测试失败' : '⏳ 等待结果') }}
            </el-tag>
          </div>
          
          <el-scrollbar height="180px" class="p-3" style="background: #1e1e1e;" always>
            <div class="font-mono text-[12px] leading-relaxed space-y-1">
              <div v-for="(log, idx) in profile.logs" :key="idx" 
                   :class="{
                     'text-[#f87171]': log.toLowerCase().includes('error') || log.toLowerCase().includes('fail') || log.toLowerCase().includes('forbidden'),
                     'text-[#4ade80]': log.toLowerCase().includes('successful') || log.toLowerCase().includes('success') || log.toLowerCase().includes('200'),
                     'text-[#d4d4d8]': !log.toLowerCase().includes('error') && !log.toLowerCase().includes('fail') && !log.toLowerCase().includes('forbidden') && !log.toLowerCase().includes('successful') && !log.toLowerCase().includes('success') && !log.toLowerCase().includes('200')
                   }">
                <span class="text-gray-500 mr-2">></span>{{ log }}
              </div>
            </div>
          </el-scrollbar>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { Odometer, User, Lock, VideoPlay, Monitor, Plus, Delete, CopyDocument, CircleClose } from '@element-plus/icons-vue';

const STORAGE_KEY = 'bi_tunnel_tester_profiles';

const profiles = ref([]);
const activeTab = ref('');

const loadProfiles = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Re-inject transient properties
      profiles.value = parsed.map(p => ({
        ...p,
        testing: false,
        logs: [],
        testResult: null
      }));
    }
  } catch (e) {
    console.error('Failed to load tester profiles', e);
  }
  
  // Create a default if empty
  if (profiles.value.length === 0) {
    addProfile();
  } else {
    activeTab.value = String(profiles.value[0].id);
  }
};

const saveProfiles = () => {
  // Strip transient properties before saving
  const toSave = profiles.value.map(p => {
    const { testing, logs, testResult, ...rest } = p;
    return rest;
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
};

const addProfile = () => {
  const newId = String(Date.now() + Math.random());
  profiles.value.push({
    id: newId,
    name: '新代理测试',
    type: 'http',
    host: '127.0.0.1',
    port: 1080,
    username: '',
    password: '',
    targetUrl: 'https://cn.bing.com',
    testing: false,
    logs: [],
    testResult: null
  });
  activeTab.value = newId;
  saveProfiles();
};

const removeProfile = (index) => {
  const removedId = String(profiles.value[index].id);
  profiles.value.splice(index, 1);
  saveProfiles();
  
  if (profiles.value.length > 0) {
    if (activeTab.value === removedId) {
      activeTab.value = String(profiles.value[Math.min(index, profiles.value.length - 1)].id);
    }
  } else {
    activeTab.value = '';
  }
};

const copyProxyUrl = async (profile) => {
  try {
    let url = `${profile.type}://`;
    if (profile.username && profile.password) {
      url += `${encodeURIComponent(profile.username)}:${encodeURIComponent(profile.password)}@`;
    } else if (profile.username) {
      url += `${encodeURIComponent(profile.username)}@`;
    }
    url += `${profile.host}:${profile.port}`;
    
    await navigator.clipboard.writeText(url);
    ElMessage.success('代理链接已复制到剪贴板！');
  } catch (err) {
    ElMessage.error('复制失败，请手动复制。');
  }
};

const handleTabsEdit = (targetName, action) => {
  if (action === 'add') {
    addProfile();
  } else if (action === 'remove') {
    const index = profiles.value.findIndex(p => String(p.id) === targetName);
    if (index !== -1) {
      removeProfile(index);
    }
  }
};

const runTest = async (profile) => {
  if (!profile.host || !profile.port || !profile.targetUrl) {
    ElMessage.warning('请填写完整的 IP、端口和测试网址！');
    return;
  }

  profile.testing = true;
  profile.logs = ['[Client] 正在发起请求至后端代理测试接口...'];
  profile.testResult = null;

  try {
    if (profile._abortController) {
      profile._abortController.abort();
    }
    profile._abortController = new AbortController();

    const res = await fetch('/api/test-proxy', {
      method: 'POST',
      signal: profile._abortController.signal,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: profile.type,
        host: profile.host,
        port: profile.port,
        username: profile.username,
        password: profile.password,
        targetUrl: profile.targetUrl
      })
    });
    
    const data = await res.json();
    profile.logs.push(...data.logs);
    profile.testResult = data.success;
    
    if (data.success) {
      ElMessage.success(`${profile.name} 测试成功！`);
    } else {
      ElMessage.error(`${profile.name} 测试失败，请查看日志！`);
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      profile.logs.push(`[Client] 测试已被用户取消。`);
      profile.testResult = false;
      ElMessage.info('测试已取消');
    } else {
      profile.logs.push(`[Client Error] 请求失败: ${err.message}`);
      profile.testResult = false;
      ElMessage.error('请求后端接口失败！');
    }
  } finally {
    profile.testing = false;
    profile._abortController = null;
  }
};

const cancelTest = (profile) => {
  if (profile._abortController) {
    profile._abortController.abort();
  }
};

onMounted(() => {
  loadProfiles();
});
</script>
