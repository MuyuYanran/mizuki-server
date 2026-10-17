<script setup lang="ts">
/**
 * [P10a] 登录页：表单 → login → 存 token → me → 主布局。
 * 未初始化（health.initialized === false）时引导进入初始化向导。
 * [Phase4-U1] 视觉重点页升级：二次元樱花光晕背景 + 大圆角浮岛卡片 + 渐变品牌标 + 渐变主按钮。
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
    <div class="login-bg-decor" aria-hidden="true">
      <div class="glow-orb orb-1" />
      <div class="glow-orb orb-2" />
    </div>

    <div class="login-card panel-card">
      <div class="login-header">
        <div class="brand-badge">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
            <path d="M12 22.5A6.5 6.5 0 0 0 12 9.5" />
          </svg>
        </div>
        <h1 class="login-title">Mizuki 管理面板</h1>
        <p class="login-subtitle">Local-first Blog Management</p>
      </div>

      <el-alert
        v-if="notInitialized"
        type="warning"
        :closable="false"
        title="系统尚未初始化"
        description="检测到服务未完成初始化，请先完成初始化向导。"
        class="login-alert"
      />

      <el-form label-position="top" class="login-form" @submit.prevent="onSubmit">
        <el-form-item label="用户名">
          <el-input
            v-model="form.username"
            placeholder="请输入管理员用户名"
            autocomplete="username"
            size="large"
          />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            autocomplete="current-password"
            show-password
            size="large"
          />
        </el-form-item>
        <div class="form-actions">
          <el-button
            type="primary"
            :loading="submitting"
            size="large"
            class="login-button btn-gradient-primary"
            @click="onSubmit"
          >
            登 录
          </el-button>
          <el-button
            v-if="notInitialized"
            text
            type="primary"
            class="init-link"
            @click="router.push('/init')"
          >
            前往初始化向导 →
          </el-button>
        </div>
      </el-form>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--mizuki-page-bg);
  position: relative;
  overflow: hidden;
  padding: 24px;
  box-sizing: border-box;
}

/* 柔和二次元氛围光晕（纯 CSS 渐变光，无外链图片） */
.login-bg-decor {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.glow-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.45;
  transition: opacity var(--mizuki-motion-base);
}

.orb-1 {
  width: 420px;
  height: 420px;
  top: -100px;
  right: -80px;
  background: radial-gradient(circle, var(--el-color-primary) 0%, transparent 70%);
}

.orb-2 {
  width: 360px;
  height: 360px;
  bottom: -80px;
  left: -60px;
  background: radial-gradient(circle, var(--el-color-primary-light-5) 0%, transparent 70%);
}

.login-card {
  width: 100%;
  max-width: 420px;
  position: relative;
  z-index: 1;
  background: var(--mizuki-glass-bg);
  backdrop-filter: var(--mizuki-glass-blur);
  -webkit-backdrop-filter: var(--mizuki-glass-blur);
  box-shadow: var(--mizuki-lift-shadow);
  padding: 36px 32px;
}

.login-header {
  text-align: center;
  margin-bottom: 28px;
}

.brand-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: var(--mizuki-radius-control);
  background: var(--mizuki-gradient-primary);
  color: #ffffff;
  box-shadow: 0 4px 14px rgba(232, 115, 158, 0.35);
  margin-bottom: 14px;
}

.login-title {
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 6px;
  background: linear-gradient(120deg, var(--el-color-primary), var(--el-color-primary-dark-2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  letter-spacing: -0.02em;
}

.login-subtitle {
  font-size: 13px;
  margin: 0;
  color: var(--el-text-color-secondary);
}

.login-alert {
  margin-bottom: 20px;
  border-radius: var(--mizuki-radius-control);
}

.login-form :deep(.el-form-item__label) {
  font-weight: 600;
  font-size: 13px;
  color: var(--el-text-color-regular);
  padding-bottom: 4px;
}

.form-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 24px;
}

.login-button {
  width: 100%;
  font-size: 15px;
  letter-spacing: 0.1em;
  height: 44px;
}

.init-link {
  width: 100%;
  font-size: 13px;
}
</style>
