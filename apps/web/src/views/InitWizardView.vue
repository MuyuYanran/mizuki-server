<script setup lang="ts">
/**
 * [P10a] 初始化向导（REQUIREMENTS §7 第 1 条逐字流程）：
 * 欢迎 → 选择 Mizuki 目录（detect 展示每项检查明细）→ 选择运行模式
 * （三模式说明）→ 设置管理员账号 → POST /system/init → 跳登录页。
 * 已初始化（409）→ 提示并跳登录。
 *
 * [U3-P3/K2] step1 重构为**树形钻取点选**为主入口（对齐 R2-2）：
 *   根层（盘符 / POSIX '/'）→ 逐级进入子目录 → 「选择此目录」回填完整路径；
 *   选中后路径以**只读**展示；手动输入折叠为「高级模式」；
 *   加载失败（404 / 409 / 网络）降级为提示 + 高级模式手输仍可用。
 *   detect 按钮 / 检测结果区 / 后续步骤零改动。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { ApiError } from '../api/http';
import { systemApi, type BrowseDirsResult, type DetectResult, type RunMode } from '../api/system';

const router = useRouter();
const step = ref(0);
const detecting = ref(false);
const submitting = ref(false);

const mizukiRoot = ref('');
const detection = ref<DetectResult | null>(null);

// ── [U3-P3/K2] 目录点选器状态 ──

/** 当前所在目录（null = 根层） */
const browsePath = ref<string | null>(null);
/** 当前层目录列表 */
const browseItems = ref<BrowseDirsResult['items']>([]);
/** 当前层是否有更多项（被 200 上限截断） */
const browseTruncated = ref(false);
/** 上级目录（null = 根层） */
const browseParent = ref<string | null>(null);
/** 目录列表加载中 */
const browsing = ref(false);
/** 目录浏览失败（降级提示；高级模式手输仍可用） */
const browseError = ref('');
/** 高级模式（手动输入）展开状态（el-collapse v-model 为数组形态） */
const advancedSections = ref<string[]>([]);

/** 目录名拼接子路径（根层项本身就是 "C:\" 这样的绝对路径） */
function joinPath(base: string | null, name: string): string {
  if (base === null) {
    return name; // 根层项即绝对路径（盘符 / '/'）
  }
  const sep = base.endsWith('/') || base.endsWith('\\') ? '' : base.includes('\\') ? '\\' : '/';
  return `${base}${sep}${name}`;
}

async function loadBrowse(target: string | null): Promise<void> {
  browsing.value = true;
  browseError.value = '';
  try {
    const result = await systemApi.browseDirs(target ?? undefined);
    browsePath.value = target;
    browseItems.value = result.items;
    browseTruncated.value = result.truncated;
    browseParent.value = result.parent;
  } catch (error) {
    browseItems.value = [];
    browseTruncated.value = false;
    browseError.value =
      error instanceof ApiError
        ? `目录加载失败：${error.message}（可展开高级模式手动输入路径）`
        : '目录加载失败（可展开高级模式手动输入路径）';
  } finally {
    browsing.value = false;
  }
}

/** 进入子目录 */
async function enterDir(name: string): Promise<void> {
  await loadBrowse(joinPath(browsePath.value, name));
}

/** 返回上级（根层时无操作） */
async function goUp(): Promise<void> {
  if (browseParent.value === null) {
    return;
  }
  await loadBrowse(browseParent.value);
}

/** 选择当前目录作为 Mizuki 根（只读回填完整路径） */
function selectCurrent(): void {
  if (browsePath.value === null) {
    ElMessage.warning('请先进入一个具体目录');
    return;
  }
  mizukiRoot.value = browsePath.value;
  ElMessage.success('已选择目录');
}

/** 当前层路径的展示文本（根层无选中目录） */
const browseCurrentLabel = computed(() => browsePath.value ?? '（根目录）');

onMounted(() => {
  void loadBrowse(null);
});

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
        <!-- [U3-P3/K2] 目录点选器（主入口）：逐级钻取 + 只读回填 -->
        <div class="browse-panel">
          <div class="browse-head">
            <span class="browse-label">当前目录</span>
            <span class="browse-current" :title="browseCurrentLabel">{{ browseCurrentLabel }}</span>
          </div>

          <el-alert v-if="browseError !== ''" type="warning" :closable="false" :title="browseError" class="browse-error" />

          <div v-loading="browsing" class="browse-list">
            <div class="browse-actions">
              <el-button size="small" :disabled="browseParent === null" @click="goUp">← 返回上级</el-button>
              <el-button size="small" type="primary" :disabled="browsePath === null" @click="selectCurrent">
                选择此目录
              </el-button>
            </div>
            <ul v-if="browseItems.length > 0" class="browse-items">
              <li
                v-for="item in browseItems"
                :key="item.name"
                class="browse-item"
                @click="enterDir(item.name)"
              >
                <span class="browse-item-name">{{ item.name }}</span>
                <el-tag v-if="item.isMizuki" type="success" size="small" class="browse-item-tag">Mizuki</el-tag>
              </li>
            </ul>
            <p v-else-if="!browsing && browseError === ''" class="browse-empty">该目录下没有子目录</p>
            <p v-if="browseTruncated" class="browse-truncated">条目过多，仅显示前 200 项（已截断）</p>
          </div>
        </div>

        <!-- 选中结果：只读展示完整路径 -->
        <el-form label-position="top" class="browse-selected">
          <el-form-item label="Mizuki 项目目录路径（已选）">
            <el-input :model-value="mizukiRoot" readonly placeholder="尚未选择目录" />
          </el-form-item>
        </el-form>

        <!-- 高级模式：手动输入（折叠） -->
        <el-collapse v-model="advancedSections">
          <el-collapse-item title="高级模式（手动输入路径）" name="advanced">
            <el-form label-position="top">
              <el-form-item label="Mizuki 项目目录路径">
                <el-input v-model="mizukiRoot" placeholder="例如 D:/blog/mizuki" />
              </el-form-item>
            </el-form>
          </el-collapse-item>
        </el-collapse>

        <el-button type="primary" :loading="detecting" @click="runDetect">检测目录</el-button>
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
        <el-button v-if="step < 3" type="primary" class="btn-gradient-primary" @click="next">下一步</el-button>
        <el-button v-else type="primary" :loading="submitting" class="btn-gradient-primary" @click="submit">完成初始化</el-button>
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
  padding: 24px;
  box-sizing: border-box;
}
.wizard-card {
  width: 100%;
  max-width: 680px;
  border-radius: var(--mizuki-radius-card);
  box-shadow: var(--mizuki-lift-shadow);
  background: var(--mizuki-glass-bg);
  backdrop-filter: var(--mizuki-glass-blur);
  -webkit-backdrop-filter: var(--mizuki-glass-blur);
  border: 1px solid var(--mizuki-border-hairline);
  padding: 32px;
}
.wizard-title {
  text-align: center;
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 20px;
  background: linear-gradient(120deg, var(--el-color-primary), var(--el-color-primary-dark-2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.wizard-steps {
  margin-bottom: 24px;
  border-radius: var(--mizuki-radius-control);
  overflow: hidden;
  border: 1px solid var(--mizuki-border-hairline);
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
  padding: 8px 0;
}
/* [U3-P3/K2] 目录点选器 */
.browse-panel {
  border: 1px solid var(--mizuki-border-hairline);
  border-radius: var(--mizuki-radius-control);
  padding: 12px 14px;
  background: var(--el-fill-color-extra-light);
  margin-bottom: 14px;
}
.browse-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}
.browse-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}
.browse-current {
  font-family: var(--el-font-family-monospace, monospace);
  font-size: 13px;
  color: var(--el-text-color-primary);
  word-break: break-all;
}
.browse-error {
  margin-bottom: 8px;
}
.browse-list {
  min-height: 80px;
}
.browse-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.browse-items {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--mizuki-border-hairline);
  border-radius: var(--mizuki-radius-control);
}
.browse-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  cursor: pointer;
  border-bottom: 1px dashed var(--mizuki-border-hairline);
}
.browse-item:last-child {
  border-bottom: none;
}
.browse-item:hover {
  background: var(--el-color-primary-light-9);
}
.browse-item-name {
  font-size: 13px;
  color: var(--el-text-color-primary);
}
.browse-item-tag {
  flex-shrink: 0;
}
.browse-empty,
.browse-truncated {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin: 8px 0 0;
}
.browse-selected {
  margin-bottom: 8px;
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
  padding: 8px 0;
  border-bottom: 1px dashed var(--mizuki-border-hairline);
}
.check-name {
  font-weight: 600;
}
.check-detail {
  color: var(--el-text-color-secondary);
  font-size: 13px;
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
  padding: 14px 16px;
  width: 100%;
  box-sizing: border-box;
  align-items: flex-start;
  border: 1px solid var(--mizuki-border-hairline);
  border-radius: var(--mizuki-radius-control);
  background: var(--el-fill-color-extra-light);
  transition: all var(--mizuki-motion-fast) ease;
}
.mode-item:hover {
  border-color: var(--el-color-primary-light-5);
  transform: translateY(-1px);
}
.mode-item.is-checked {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  box-shadow: 0 2px 10px rgba(232, 115, 158, 0.12);
}
.mode-item :deep(.el-radio__label) {
  white-space: normal;
  line-height: 1.5;
  padding-left: 8px;
  width: 100%;
}
.mode-label {
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.mode-desc {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  margin-top: 2px;
}
.wizard-actions {
  margin-top: 28px;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
