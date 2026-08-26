<script setup lang="ts">
/**
 * [P10a] 登录页：表单 → login → 存 token → me → 主布局。
 * 未初始化（health.initialized === false）时引导进入初始化向导。
 */
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { authApi } from '../api/auth';
import { ApiError } from '../api/http';
import { systemApi } from '../api/system';
import { setTokens, setUser } from '../stores/auth';

const router = useRouter();
const submitting = ref(false);
const notInitialized = ref(false);
const form = reactive({ username: '', password: '' });

onMounted(async () => {
  try {
    const health = await systemApi.health();
    if (!health.initialized) {
      notInitialized.value = true;
    }
  } catch {
    // 健康检查失败不阻塞登录表单本身
  }
});

async function onSubmit(): Promise<void> {
  if (form.username === '' || form.password === '') {
    ElMessage.warning('请输入用户名与密码');
    return;
  }
  submitting.value = true;
  try {
    const tokens = await authApi.login(form.username, form.password);
    setTokens(tokens.accessToken, tokens.refreshToken);
    try {
      setUser(await authApi.me());
    } catch {
      // me 失败不阻断登录跳转（布局侧显示占位用户名）
    }
    ElMessage.success('登录成功');
    void router.push('/');
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) {
        ElMessage.error('用户名或密码错误');
      } else if (error.status === 423) {
        ElMessage.error(error.message || '账户已锁定，请稍后重试');
      } else if (error.status === 429) {
        ElMessage.error('尝试过于频繁，请稍后再试');
      } else {
        ElMessage.error(error.message);
      }
    } else {
      ElMessage.error('网络错误，请稍后重试');
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <el-card class="login-card">
      <h1 class="login-title">Mizuki 管理面板</h1>
      <el-alert
        v-if="notInitialized"
        type="warning"
        :closable="false"
        title="系统尚未初始化"
        description="检测到服务未完成初始化，请先完成初始化向导。"
        class="login-alert"
      />
      <el-form label-position="top" @submit.prevent="onSubmit">
        <el-form-item label="用户名">
          <el-input v-model="form.username" placeholder="用户名" autocomplete="username" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="密码"
            autocomplete="current-password"
            show-password
          />
        </el-form-item>
        <el-button type="primary" :loading="submitting" class="login-button" @click="onSubmit">
          登录
        </el-button>
        <el-button v-if="notInitialized" text type="primary" @click="router.push('/init')">
          前往初始化向导
        </el-button>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f0f2f5;
}
.login-card {
  width: 380px;
}
.login-title {
  text-align: center;
  font-size: 20px;
  margin: 0 0 16px;
}
.login-alert {
  margin-bottom: 16px;
}
.login-button {
  width: 100%;
}
</style>
