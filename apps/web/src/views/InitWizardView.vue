<script setup lang="ts">
/**
 * [P10a] 初始化向导（REQUIREMENTS §7 第 1 条逐字流程）：
 * 欢迎 → 选择 Mizuki 目录（detect 展示每项检查明细）→ 选择运行模式
 * （三模式说明）→ 设置管理员账号 → POST /system/init → 跳登录页。
 * 已初始化（409）→ 提示并跳登录。
 */
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { ApiError } from '../api/http';
import { systemApi, type DetectResult, type RunMode } from '../api/system';

const router = useRouter();
const step = ref(0);
const detecting = ref(false);
const submitting = ref(false);

const mizukiRoot = ref('');
const detection = ref<DetectResult | null>(null);

const mode = ref<RunMode>('manage');
const MODES: { value: RunMode; label: string; description: string }[] = [
  {
    value: 'manage',
    label: '仅管理模式（无侵入）',
    description: '不修改 Mizuki 原项目文件结构，仅按需写入内容数据文件。推荐首选。',
  },
  {
    value: 'additive',
    label: '新增文件接入（低侵入）',
    description: '只新增文件接入后端能力（API 客户端、评论组件等），不覆盖原文件。（二期能力）',
  },
  {
    value: 'overwrite',
    label: '覆盖文件接入（高侵入）',
    description: '允许修改/覆盖 Mizuki 原文件，接入完整后端能力。（二期能力）',
  },
];

const account = reactive({ username: '', password: '', confirm: '' });

const canNextFromDetect = computed(() => detection.value !== null && detection.value.valid);

async function runDetect(): Promise<void> {
  if (mizukiRoot.value.trim() === '') {
    ElMessage.warning('请输入 Mizuki 项目目录路径');
    return;
  }
  detecting.value = true;
  try {
    detection.value = await systemApi.detect(mizukiRoot.value.trim());
    if (!detection.value.valid) {
      ElMessage.error('检测未通过：该目录不是有效的 Mizuki 项目');
    }
  } catch (error) {
    detection.value = null;
    ElMessage.error(error instanceof ApiError ? error.message : '检测请求失败');
  } finally {
    detecting.value = false;
  }
}

function next(): void {
  if (step.value === 1 && !canNextFromDetect.value) {
    ElMessage.warning('请先通过目录检测');
    return;
  }
  step.value += 1;
}

async function submit(): Promise<void> {
  if (account.username === '' || account.password === '' || account.confirm === '') {
    ElMessage.warning('请完整填写账号信息');
    return;
  }
  if (account.password !== account.confirm) {
    ElMessage.error('两次输入的密码不一致');
    return;
  }
  submitting.value = true;
  try {
    await systemApi.init({
      mizukiRoot: mizukiRoot.value.trim(),
      mode: mode.value,
      username: account.username,
      password: account.password,
    });
    ElMessage.success('初始化完成，请登录');
    void router.push('/login');
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      ElMessage.warning('系统已初始化，请直接登录');
      void router.push('/login');
    } else {
      ElMessage.error(error instanceof ApiError ? error.message : '初始化失败');
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="wizard-page">
    <el-card class="wizard-card">
      <h1 class="wizard-title">Mizuki-Server 初始化向导</h1>
      <el-steps :active="step" finish-status="success" simple class="wizard-steps">
        <el-step title="欢迎" />
        <el-step title="选择目录" />
        <el-step title="运行模式" />
        <el-step title="管理员账号" />
      </el-steps>

      <div v-if="step === 0" class="wizard-body">
        <p>欢迎使用 Mizuki-Server。本向导将引导完成一次性初始化：</p>
        <p>选择 Mizuki 项目目录 → 检测并展示结果 → 选择运行模式 → 设置管理员账号。</p>
        <p>初始化仅可执行一次，完成后请牢记管理员账号。</p>
      </div>

      <div v-else-if="step === 1" class="wizard-body">
        <el-form label-position="top">
          <el-form-item label="Mizuki 项目目录路径">
            <el-input v-model="mizukiRoot" placeholder="例如 D:/blog/mizuki" />
          </el-form-item>
          <el-button type="primary" :loading="detecting" @click="runDetect">检测目录</el-button>
        </el-form>
        <div v-if="detection" class="detect-result">
          <el-alert
            :type="detection.valid ? 'success' : 'error'"
            :closable="false"
            :title="detection.valid ? '检测通过' : '检测未通过'"
            :description="`包管理器探测：${detection.packageManager}`"
          />
          <ul class="detect-checks">
            <li v-for="check in detection.checks" :key="check.name">
              <el-tag :type="check.passed ? 'success' : 'danger'" size="small">
                {{ check.passed ? '通过' : '失败' }}
              </el-tag>
              <span class="check-name">{{ check.name }}</span>
              <span class="check-detail">{{ check.detail }}</span>
            </li>
          </ul>
        </div>
      </div>

      <div v-else-if="step === 2" class="wizard-body">
        <el-radio-group v-model="mode" class="mode-group">
          <el-radio v-for="item in MODES" :key="item.value" :value="item.value" class="mode-item">
            <div class="mode-label">{{ item.label }}</div>
            <div class="mode-desc">{{ item.description }}</div>
          </el-radio>
        </el-radio-group>
      </div>

      <div v-else class="wizard-body">
        <el-form label-position="top" @submit.prevent="submit">
          <el-form-item label="用户名">
            <el-input v-model="account.username" autocomplete="username" />
          </el-form-item>
          <el-form-item label="密码">
            <el-input v-model="account.password" type="password" show-password autocomplete="new-password" />
          </el-form-item>
          <el-form-item label="确认密码">
            <el-input v-model="account.confirm" type="password" show-password autocomplete="new-password" />
          </el-form-item>
        </el-form>
      </div>

      <div class="wizard-actions">
        <el-button v-if="step > 0" @click="step -= 1">上一步</el-button>
        <el-button v-if="step < 3" type="primary" @click="next">下一步</el-button>
        <el-button v-else type="primary" :loading="submitting" @click="submit">完成初始化</el-button>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.wizard-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f0f2f5;
}
.wizard-card {
  width: 640px;
}
.wizard-title {
  text-align: center;
  font-size: 20px;
  margin: 0 0 16px;
}
.wizard-steps {
  margin-bottom: 24px;
}
.wizard-body {
  min-height: 220px;
}
.detect-result {
  margin-top: 16px;
}
.detect-checks {
  list-style: none;
  padding: 0;
  margin: 12px 0 0;
}
.detect-checks li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
}
.check-name {
  font-weight: 600;
}
.check-detail {
  color: #606266;
}
.mode-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mode-item {
  height: auto;
  white-space: normal;
}
.mode-label {
  font-weight: 600;
}
.mode-desc {
  color: #606266;
  font-size: 13px;
}
.wizard-actions {
  margin-top: 24px;
  text-align: right;
}
</style>
