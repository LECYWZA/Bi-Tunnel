<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-col gap-4 sticky top-[60px] z-10 bg-white dark:bg-gray-900 pb-4 -mx-6 px-6 pt-4 -mt-4">
      <div class="flex justify-between items-center bt-section-status">
        <div class="flex items-center gap-3">
          <el-icon :size="24" style="color: var(--bt-primary)"><Memo /></el-icon>
          <span class="font-bold text-lg bt-text">{{ t('rules.headerTitle') }}</span>
        </div>
        <el-button type="primary" :icon="Plus" @click="openCreateDialog">{{ t('rules.createCard') }}</el-button>
      </div>
    </div>

    <!-- Empty State -->
    <el-empty
      v-if="!config.ruleCards || config.ruleCards.length === 0"
      :description="t('rules.emptyDescription')"
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
          <div class="text-xs font-bold text-gray-500 mb-2">{{ t('rules.patternsCount', { count: card.patterns ? card.patterns.length : 0 }) }}:</div>
          <div v-if="!card.patterns || card.patterns.length === 0" class="text-xs text-gray-400 italic">{{ t('rules.emptyPatterns') }}</div>
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
              {{ t('rules.morePatterns', { count: card.patterns.length - 6 }) }}
            </div>
          </div>
        </div>

        <!-- Footer Actions -->
        <div class="flex justify-end gap-2 mt-auto pt-3" style="border-top: 1px solid var(--bt-border);">
          <el-button type="primary" plain :icon="Edit" size="small" @click="openEditDialog(card)">{{ t('rules.editBtn') }}</el-button>
          <el-popconfirm :title="t('rules.deleteCardConfirm')" @confirm="deleteCard(card.id, idx)">
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
      :title="isEdit ? t('rules.editDialogTitle') : t('rules.createDialogTitle')"
      width="600px"
      destroy-on-close
    >
      <el-form label-position="top">
        <el-form-item :label="t('rules.formCardName')" required>
          <el-input v-model="editForm.name" :placeholder="t('rules.formCardNamePlaceholder')" />
        </el-form-item>

        <el-form-item :label="t('rules.formRulesLabel')">
          <div class="w-full flex flex-col gap-3">
            <!-- Quick insertion templates -->
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-gray-500 whitespace-nowrap">{{ t('rules.quickTemplatesLabel') }}</span>
              <el-select v-model="quickPattern" :placeholder="t('rules.quickPatternPlaceholder')" filterable style="flex: 1;" size="small">
                <el-option-group :label="t('rules.groupGeoIP')">
                  <el-option :label="t('rules.geoIpCn')" value="geoip:cn" />
                  <el-option :label="t('rules.geoIpNotCn')" value="geoip:!cn" />
                </el-option-group>
                <el-option-group :label="t('rules.groupLan')">
                  <el-option :label="t('rules.lan10')" value="10.*.*.*" />
                  <el-option :label="t('rules.lan172')" value="172.*.*.*" />
                  <el-option :label="t('rules.lan192')" value="192.168.*.*" />
                  <el-option :label="t('rules.lanLocalhost')" value="127.*.*.*" />
                </el-option-group>
                <el-option-group :label="t('rules.groupDomain')">
                  <el-option :label="t('rules.domainAny')" value="*" />
                  <el-option :label="t('rules.domainGoogle')" value="*.google.com" />
                  <el-option :label="t('rules.domainYoutube')" value="*.youtube.com" />
                  <el-option :label="t('rules.domainOpenai')" value="*.openai.com" />
                  <el-option :label="t('rules.domainGithub')" value="*.github.com" />
                  <el-option :label="t('rules.domainHuggingface')" value="*.huggingface.co" />
                  <el-option :label="t('rules.domainDocker')" value="*.docker.com" />
                  <el-option :label="t('rules.domainTelegram')" value="*.telegram.org" />
                  <el-option :label="t('rules.domainMicrosoft')" value="*.microsoft.com" />
                </el-option-group>
              </el-select>
              <el-button type="primary" size="small" :icon="Plus" @click="appendTemplate">{{ t('rules.appendBtn') }}</el-button>
            </div>

            <!-- Rules input textarea -->
            <el-input
              v-model="editForm.text"
              type="textarea"
              :rows="12"
              :placeholder="t('rules.rulesInputPlaceholder')"
              style="font-family: monospace;"
            />
          </div>
        </el-form-item>
      </el-form>

      <template #footer>
        <span class="dialog-footer">
          <el-button @click="dialogVisible = false">{{ t('common.cancel') }}</el-button>
          <el-button type="primary" @click="saveCard">{{ t('common.save') }}</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';
import { Memo, Plus, Edit, Delete } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { t } from '../i18n';

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
  ElMessage.success(t('rules.templateAppended'));
};

const saveCard = () => {
  if (!editForm.name.trim()) {
    ElMessage.warning(t('rules.nameRequired'));
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
  ElMessage.success(t('rules.saveSuccess'));
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
  ElMessage.success(t('rules.deleteSuccess'));
};
</script>

<style scoped>
.sticky {
  background-color: var(--bt-bg);
}
</style>
