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

// [W4-A] 字段级错误回填（与后端 InitBodySchema 字段路径对齐）
const usernameError = ref('');
const passwordError = ref('');

/** 后端 zod issue 文案中文化（保持契约：path 为字段名，message 保留原意或中文化） */
function zhIssueMessage(raw: string): string {
  // 覆盖 InitBodySchema 实际触发的几条；未命中时回落到原值
  if (raw.startsWith('Too small: expected string to have >=8 characters')) return '密码至少 8 个字符';
  if (raw.startsWith('Too small: expected string to have >=1 characters')) return '字段不能为空';
  if (raw.startsWith('Too small: expected string to have >=64 characters')) return '用户名最长 64 个字符';
  if (raw.startsWith('Too small: expected string to have >=200 characters')) return '密码最长 200 个字符';
  if (raw.startsWith('Invalid option: expected one of')) return '取值不在允许范围内';
  if (raw === 'Invalid input: expected string, received undefined') return '字段缺失';
  if (raw.startsWith('Invalid input: expected string, received')) return '字段类型错误';
  return raw;
}

function clearFieldErrors(): void {
  usernameError.value = '';
  passwordError.value = '';
}

/** 把后端 detail.issues[] 投影到对应字段的 :error 状态 */
function applyIssuesToFields(issues: { path: string; message: string }[]): void {
  for (const issue of issues) {
    const msg = zhIssueMessage(issue.message);
    if (issue.path === 'username') {
      usernameError.value = msg;
    } else if (issue.path === 'password') {
      passwordError.value = msg;
    }
  }
}

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
  clearFieldErrors();
  if (account.username === '' || account.password === '' || account.confirm === '') {
    ElMessage.warning('请完整填写账号信息');
    return;
  }
  if (account.password !== account.confirm) {
    ElMessage.error('两次输入的密码不一致');
    return;
  }
  // [W4-A] 客户端预校验：与后端 InitBodySchema 对齐
  //   password min 8 / max 200 / username max 64
  //   提前拦截高频错误，避免「请求体校验失败」一句话掩盖字段细节
  if (account.username.length > 64) {
    usernameError.value = '用户名最长 64 个字符';
    return;
  }
  if (account.password.length < 8) {
    passwordError.value = '密码至少 8 个字符';
    return;
  }
  if (account.password.length > 200) {
    passwordError.value = '密码最长 200 个字符';
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
    } else if (error instanceof ApiError && error.status === 400) {
      // [W4-A] 把后端 detail.issues 展开为字段级错误 + 摘要 toast
      // 替代原行为「只显示 message（'请求体校验失败'）」——用户原本无法判断哪个字段有问题
      const detail = error.detail as { issues?: { path: string; message: string }[] } | null;
      const issues = detail?.issues ?? [];
      if (issues.length > 0) {
        applyIssuesToFields(issues);
        const summary = issues.map((i) => `${i.path}: ${zhIssueMessage(i.message)}`).join('；');
        ElMessage.error(`请求体校验未通过 — ${summary}`);
      } else {
        ElMessage.error(error.message);
      }
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
          <el-form-item label="用户名" :error="usernameError">
            <el-input v-model="account.username" autocomplete="username" />
          </el-form-item>
          <el-form-item label="密码" :error="passwordError">
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
  background: var(--mizuki-page-bg);
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
/* [Phase2-B1 / R2-3] 步骤标签不折行：nowrap + 防收缩；窄窗口字号略缩 */
.wizard-steps :deep(.el-step__title) {
  white-space: nowrap;
  font-size: 13px;
  line-height: 1.6;
}
.wizard-steps :deep(.el-step.is-simple) {
  flex-shrink: 0;
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
  color: var(--el-text-color-secondary);
}
/* [Phase2-B1 / R2-4] 运行模式三选项：垂直排列、同一左缩进基准、
   等宽卡片行（radio 圆点对齐 + 标签/说明双行块），消除参差缩进 */
.mode-group {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
}
.mode-item {
  height: auto;
  margin: 0;
  padding: 12px 14px;
  width: 100%;
  box-sizing: border-box;
  align-items: flex-start;
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  background: var(--el-fill-color-extra-light);
}
.mode-item.is-checked {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.mode-item :deep(.el-radio__label) {
  white-space: normal;
  line-height: 1.5;
  padding-left: 6px;
  width: 100%;
}
.mode-label {
  font-weight: 600;
}
.mode-desc {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.wizard-actions {
  margin-top: 24px;
  text-align: right;
}
</style>
