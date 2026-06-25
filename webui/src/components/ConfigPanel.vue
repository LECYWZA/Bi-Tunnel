<template>
  <div>
    <el-row :gutter="24">
      <el-col :span="12">
        <ConfigSection 
          mode="server" 
          title="服务端配置" 
          :config="config" 
          :status="status"
          :availableIps="availableIps"
          @start="$emit('start', 'server')"
          @stop="$emit('stop', 'server')"
        />
      </el-col>
      <el-col :span="12">
        <ConfigSection 
          mode="client" 
          title="客户端配置" 
          :config="config" 
          :status="status"
          :availableIps="availableIps"
          @start="$emit('start', 'client')"
          @stop="$emit('stop', 'client')"
        />
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import ConfigSection from './ConfigSection.vue';

const props = defineProps({
  config: Object,
  status: Object,
  availableIps: Array
});

const emit = defineEmits(['save', 'start', 'stop']);
</script>
