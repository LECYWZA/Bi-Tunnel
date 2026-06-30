<template>
  <div>
    <el-row :gutter="24">
      <el-col :xs="24" :xl="12">
        <ForwardSection
          mode="server"
          :title="t('forward.serverConfigTitle')"
          :config="config"
          :status="status"
          :availableIps="availableIps"
          @start="$emit('start', 'server')"
          @stop="$emit('stop', 'server')"
          @save="$emit('save')"
        />
      </el-col>
      <el-col :xs="24" :xl="12">
        <ForwardSection
          mode="client"
          :title="t('forward.clientConfigTitle')"
          :config="config"
          :status="status"
          :availableIps="availableIps"
          @start="$emit('start', 'client')"
          @stop="$emit('stop', 'client')"
          @save="$emit('save')"
        />
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import ForwardSection from './ForwardSection.vue';
import { t } from '../i18n';

const props = defineProps({
  config: Object,
  status: Object,
  availableIps: Array
});

const emit = defineEmits(['save', 'start', 'stop']);
</script>
