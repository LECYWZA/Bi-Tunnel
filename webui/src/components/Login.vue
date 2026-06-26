<template>
  <div class="login-container" :class="{ 'is-dark': isDark }">
    <div class="login-card">
      <div class="login-header">
        <div class="logo-box">
          <el-icon :size="24" color="#fff"><Connection /></el-icon>
        </div>
        <h2>Bi-Tunnel</h2>
        <p>安全的高性能双向穿透控制台</p>
      </div>

      <el-form @keyup.enter="handleLogin" :model="form" :rules="rules" ref="formRef" size="large">
        <el-form-item prop="username">
          <el-input v-model="form.username" placeholder="请输入账号 (默认: admin)" :prefix-icon="User" />
        </el-form-item>
        <el-form-item prop="password">
          <el-input v-model="form.password" type="password" placeholder="请输入密码 (默认: password)" :prefix-icon="Lock" show-password />
        </el-form-item>
        <el-button type="primary" class="login-btn" :loading="loading" @click="handleLogin">
          进入控制台
        </el-button>
      </el-form>
      
      <div class="theme-toggle" @click="toggleTheme" :title="isDark ? '切换到亮色模式' : '切换到暗色模式'">
        {{ isDark ? '☀️' : '🌙' }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';
import { User, Lock, Connection } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';

const props = defineProps({
  isDark: Boolean
});

const emit = defineEmits(['update:isDark', 'login-success']);

const toggleTheme = () => {
  emit('update:isDark', !props.isDark);
};

const formRef = ref(null);
const form = reactive({
  username: '',
  password: ''
});
const rules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
};
const loading = ref(false);

const handleLogin = async () => {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (valid) {
      loading.value = true;
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form)
        });
        const data = await res.json();
        if (data.success) {
          ElMessage.success('登录成功');
          emit('login-success');
        } else {
          ElMessage.error(data.message || '登录失败');
        }
      } catch (err) {
        ElMessage.error('网络错误: ' + err.message);
      } finally {
        loading.value = false;
      }
    }
  });
};
</script>

<style scoped>
.login-container {
  width: 100vw;
  height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
  transition: all 0.3s ease;
}

.login-container.is-dark {
  background: linear-gradient(135deg, #1a1c2c 0%, #4a192c 100%);
}

.login-card {
  width: 400px;
  padding: 40px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(20px);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  position: relative;
  transition: all 0.3s ease;
}

.is-dark .login-card {
  background: rgba(30, 30, 30, 0.85);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.login-header {
  text-align: center;
  margin-bottom: 40px;
}

.logo-box {
  width: 56px;
  height: 56px;
  margin: 0 auto 16px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 16px;
  display: flex;
  justify-content: center;
  align-items: center;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
}

h2 {
  margin: 0 0 8px;
  font-size: 24px;
  font-weight: 700;
  color: #2c3e50;
}

.is-dark h2 {
  color: #e5eaf3;
}

p {
  margin: 0;
  font-size: 14px;
  color: #7f8c8d;
}

.is-dark p {
  color: #a0aabf;
}

.login-btn {
  width: 100%;
  margin-top: 10px;
  height: 44px;
  font-size: 16px;
  border-radius: 8px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
}

.login-btn:hover {
  opacity: 0.9;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.theme-toggle {
  position: absolute;
  top: 20px;
  right: 20px;
  cursor: pointer;
  font-size: 20px;
  opacity: 0.7;
  transition: opacity 0.2s;
}

.theme-toggle:hover {
  opacity: 1;
}
</style>
