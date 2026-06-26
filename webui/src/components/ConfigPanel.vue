<template>
  <div>
    <el-row :gutter="24">
      <el-col :span="12">
        <ForwardSection 
          mode="server" 
          title="服务端配置" 
          :config="config" 
          :status="status"
          :availableIps="availableIps"
          @start="$emit('start', 'server')"
          @stop="$emit('stop', 'server')"
          @save="$emit('save')"
        />
      </el-col>
      <el-col :span="12">
        <ForwardSection 
          mode="client" 
          title="客户端配置" 
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

const props = defineProps({
  config: Object,
  status: Object,
  availableIps: Array
});

const emit = defineEmits(['save', 'start', 'stop']);
</script>
