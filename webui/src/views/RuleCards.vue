<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-col gap-4 sticky top-[60px] z-10 bg-white dark:bg-gray-900 pb-4 -mx-6 px-6 pt-4 -mt-4">
      <div class="flex justify-between items-center bt-section-status">
        <div class="flex items-center gap-3">
          <el-icon :size="24" style="color: var(--bt-primary)"><Memo /></el-icon>
          <span class="font-bold text-lg bt-text">分流规则管理 (Rule Cards)</span>
        </div>
        <el-button type="primary" :icon="Plus" @click="openCreateDialog">创建分流规则卡片</el-button>
      </div>
    </div>

    <!-- Empty State -->
    <el-empty 
      v-if="!config.ruleCards || config.ruleCards.length === 0" 
      description="暂无分流规则卡片，请点击右上角创建" 
      :image-size="80" 
    />

    <!-- Rule Cards Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6" v-else>
      <el-card 
        v-for="(card, idx) in config.ruleCards" 
        :key="card.id" 
        shadow="hover" 
        class="bt-card h-full transition-transform hover:-translate-y-1" 
        body-class="flex flex-col h-full"
      >
        <div class="flex justify-between items-center mb-4 pb-3" style="border-bottom: 1px solid var(--bt-border);">
          <div class="font-bold text-lg bt-text truncate flex-1">{{ card.name }}</div>
          <el-tag size="small" type="info" effect="plain" round>ID: {{ card.id.split('_')[2] || card.id }}</el-tag>
        </div>

        <div class="flex-1 mb-4">
          <div class="text-xs font-bold text-gray-500 mb-2">包含规则 (共 {{ card.patterns ? card.patterns.length : 0 }} 条):</div>
          <div v-if="!card.patterns || card.patterns.length === 0" class="text-xs text-gray-400 italic">空规则列表</div>
          <div v-else class="flex flex-col gap-1">
            <div 
              v-for="(pattern, pIdx) in card.patterns.slice(0, 6)" 
              :key="pIdx" 
              class="font-mono text-xs p-1.5 rounded" 
              style="background: var(--bt-input-bg); border: 1px solid var(--bt-border); color: var(--bt-text);"
            >
              {{ pattern }}
            </div>
            <div v-if="card.patterns.length > 6" class="text-xs text-gray-400 pl-1 mt-1">
              ... 以及其他 {{ card.patterns.length - 6 }} 条规则
            </div>
          </div>
        </div>

        <!-- Footer Actions -->
        <div class="flex justify-end gap-2 mt-auto pt-3" style="border-top: 1px solid var(--bt-border);">
          <el-button type="primary" plain :icon="Edit" size="small" @click="openEditDialog(card)">编辑规则</el-button>
          <el-popconfirm title="确定要删除这张规则卡片吗？这会自动清除混合代理中对它的引用。" @confirm="deleteCard(card.id, idx)">
            <template #reference>
              <el-button type="danger" plain :icon="Delete" size="small" />
            </template>
          </el-popconfirm>
        </div>
      </el-card>
    </div>

    <!-- Edit/Create Dialog -->
    <el-dialog 
      v-model="dialogVisible" 
      :title="isEdit ? '编辑分流规则卡片' : '创建分流规则卡片'" 
      width="600px"
      destroy-on-close
    >
      <el-form label-position="top">
        <el-form-item label="规则卡片名称" required>
          <el-input v-model="editForm.name" placeholder="例如: 常用开发服务 / 国内直连 / 广告过滤" />
        </el-form-item>

        <el-form-item label="规则列表 (每行一条规则)">
          <div class="w-full flex flex-col gap-3">
            <!-- Quick insertion templates -->
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-gray-500 whitespace-nowrap">常用模板:</span>
              <el-select v-model="quickPattern" placeholder="选择常用规则模板直接追加" filterable style="flex: 1;" size="small">
                <el-option-group label="基于 GeoIP 分流">
                  <el-option label="国内 IP (geoip:cn)" value="geoip:cn" />
                  <el-option label="非国内/海外 IP (geoip:!cn)" value="geoip:!cn" />
                </el-option-group>
                <el-option-group label="局域网与私有地址">
                  <el-option label="10.x.x.x (10.*.*.*)" value="10.*.*.*" />
                  <el-option label="172.16-31.x.x (172.*.*.*)" value="172.*.*.*" />
                  <el-option label="192.168.x.x (192.168.*.*)" value="192.168.*.*" />
                  <el-option label="Localhost (127.*.*.*)" value="127.*.*.*" />
                </el-option-group>
                <el-option-group label="常见域名规则">
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
              <el-button type="primary" size="small" :icon="Plus" @click="appendTemplate">添加至末尾</el-button>
            </div>

            <!-- Rules input textarea -->
            <el-input 
              v-model="editForm.text" 
              type="textarea" 
              :rows="12" 
              placeholder="输入分流规则，一行一条。支持通配符。&#10;例如:&#10;*.google.com&#10;geoip:cn&#10;192.168.*.*"
              style="font-family: monospace;"
            />
          </div>
        </el-form-item>
      </el-form>

      <template #footer>
        <span class="dialog-footer">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" @click="saveCard">保存</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';
import { Memo, Plus, Edit, Delete } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';

const props = defineProps({
  config: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(['save']);

const dialogVisible = ref(false);
const isEdit = ref(false);
const currentCardId = ref(null);
const quickPattern = ref('');

const editForm = reactive({
  name: '',
  text: ''
});

const openCreateDialog = () => {
  isEdit.value = false;
  currentCardId.value = null;
  quickPattern.value = '';
  editForm.name = '';
  editForm.text = '';
  dialogVisible.value = true;
};

const openEditDialog = (card) => {
  isEdit.value = true;
  currentCardId.value = card.id;
  quickPattern.value = '';
  editForm.name = card.name;
  editForm.text = card.patterns ? card.patterns.join('\n') : '';
  dialogVisible.value = true;
};

const appendTemplate = () => {
  if (!quickPattern.value) return;
  const currentText = editForm.text.trim();
  if (currentText === '') {
    editForm.text = quickPattern.value;
  } else {
    editForm.text = currentText + '\n' + quickPattern.value;
  }
  quickPattern.value = '';
  ElMessage.success('模板规则已追加');
};

const saveCard = () => {
  if (!editForm.name.trim()) {
    ElMessage.warning('请输入规则卡片名称');
    return;
  }

  // Parse lines
  const patterns = editForm.text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');

  if (!props.config.ruleCards) {
    props.config.ruleCards = [];
  }

  if (isEdit.value) {
    const card = props.config.ruleCards.find(c => c.id === currentCardId.value);
    if (card) {
      card.name = editForm.name.trim();
      card.patterns = patterns;
    }
  } else {
    const newCard = {
      id: 'rule_card_' + Math.random().toString(36).substr(2, 9),
      name: editForm.name.trim(),
      patterns: patterns
    };
    props.config.ruleCards.push(newCard);
  }

  emit('save');
  dialogVisible.value = false;
  ElMessage.success('分流规则卡片保存成功');
};

const deleteCard = (cardId, idx) => {
  if (!props.config.ruleCards) return;
  props.config.ruleCards.splice(idx, 1);

  // Clean references in client/server proxies
  const cleanProxies = (proxies) => {
    if (!proxies) return;
    proxies.forEach(px => {
      if (px.proxyRules) {
        px.proxyRules.forEach(r => {
          if (r.ruleCardIds) {
            r.ruleCardIds = r.ruleCardIds.filter(id => id !== cardId);
          }
          if (r.ruleCardId === cardId) {
            delete r.ruleCardId;
          }
        });
        px.proxyRules = px.proxyRules.filter(r => 
          (r.ruleCardIds && r.ruleCardIds.length > 0) || r.ruleCardId
        );
      }
    });
  };
  
  cleanProxies(props.config.server?.proxies);
  cleanProxies(props.config.client?.proxies);

  emit('save');
  ElMessage.success('规则卡片删除成功，相关分流规则已自动解绑');
};
</script>

<style scoped>
.sticky {
  background-color: var(--bt-bg);
}
</style>
