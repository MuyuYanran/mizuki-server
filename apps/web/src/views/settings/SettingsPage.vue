<script setup lang="ts">
/**
 * [P10d] 设置管理页面
 * [职责] 对接 P8 settings REST（GET/PUT/DELETE）；按值类型渲染控件
 *   （布尔→开关、数字→文本输入、字符串→文本框、复杂对象→JSON 文本编辑 +
 *   前端 JSON.parse 校验）；按 key 前缀分组展示；支持新增 key。
 * [状态] ACTIVE
 *
 * 边界（§3.6）：仅读写 site_setting（运行态配置）；
 * data/config.json（启动配置，如 mizukiRoot）不在此修改——页面注明该边界。
 * Mizuki 侧 config/主题配置文件接管属二期能力，本页仅覆盖 settings 表范围。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { settingsApi } from '../../api/settings';
import { authApi } from '../../api/auth';
import { clearAuth } from '../../stores/auth';
import { ApiError } from '../../api/http';

/** 单个设置项的编辑态 */
interface SettingItem {
  key: string;
  value: unknown;
  original: string;
  text: string;
  parseError: string;
}

const items = ref<SettingItem[]>([]);
const loading = ref(false);
const saving = ref<string | null>(null);

const newKey = ref('');
const newValue = ref('');

const GROUP_PREFIXES = ['site', 'theme', 'nav', 'social', 'feature', 'service'];
const GROUP_LABELS: Record<string, string> = {
  site: '站点基础信息',
  theme: '主题配置',
  nav: '导航配置',
  social: '社交链接',
  feature: '功能开关',
  service: '服务参数',
  other: '其他',
};

const grouped = computed<{ group: string; label: string; items: SettingItem[] }[]>(() => {
  const map = new Map<string, SettingItem[]>();
  for (const item of items.value) {
    const prefix = item.key.split('.')[0] ?? 'other';
    const group = GROUP_PREFIXES.includes(prefix) ? prefix : 'other';
    const arr = map.get(group) ?? [];
    arr.push(item);
    map.set(group, arr);
  }
  return GROUP_PREFIXES.concat('other')
    .filter((g) => map.has(g))
    .map((g) => ({ group: g, label: GROUP_LABELS[g] ?? g, items: map.get(g) ?? [] }));
});

function valueTypeOf(value: unknown): 'boolean' | 'number' | 'string' | 'object' {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'object' && value !== null) return 'object';
  return 'string';
}

async function fetchAll(): Promise<void> {
  loading.value = true;
  try {
    const all = await settingsApi.getAll();
    items.value = Object.entries(all).map(([key, value]) => {
      const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      return { key, value, original: text, text, parseError: '' };
    });
  } catch (e) {
    handleError(e, '加载设置失败');
  } finally {
    loading.value = false;
  }
}

async function onSave(item: SettingItem): Promise<void> {
  let value: unknown;
  const kind = valueTypeOf(item.value);
  if (kind === 'object') {
    try {
      value = JSON.parse(item.text);
      item.parseError = '';
    } catch (e) {
      item.parseError = e instanceof Error ? e.message : 'JSON 格式错误';
      return;
    }
  } else if (kind === 'number') {
    value = Number(item.text);
  } else if (kind === 'boolean') {
    value = item.text === 'true';
  } else {
    value = item.text;
  }
  saving.value = item.key;
  try {
    await settingsApi.put(item.key, value);
    item.original = item.text;
    ElMessage.success('已保存');
  } catch (e) {
    handleError(e, '保存失败');
  } finally {
    saving.value = null;
  }
}

async function onDelete(item: SettingItem): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除设置项「${item.key}」？`, '删除确认', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await settingsApi.remove(item.key);
    ElMessage.success('已删除');
    await fetchAll();
  } catch (e) {
    handleError(e, '删除失败');
  }
}

async function onAdd(): Promise<void> {
  const key = newKey.value.trim();
  if (key === '') {
    ElMessage.warning('请输入 key');
    return;
  }
  let value: unknown;
  try {
    value = newValue.value.trim() === '' ? '' : JSON.parse(newValue.value);
  } catch {
    value = newValue.value;
  }
  try {
    await settingsApi.put(key, value);
    ElMessage.success('已新增');
    newKey.value = '';
    newValue.value = '';
    await fetchAll();
  } catch (e) {
    handleError(e, '新增失败');
  }
}

function handleError(e: unknown, fallback: string): void {
  if (e instanceof ApiError) {
    ElMessage.error(e.message);
  } else {
    ElMessage.error(fallback);
  }
}

// ── [B2/裁决 5] 修改密码卡片 ──

const router = useRouter();

const passwordForm = reactive({ oldPassword: '', newPassword: '', confirm: '' });
const changingPassword = ref(false);

/** 强度校验同注册（后端 InitBody/changePassword 同基线：最短 8 位） */
function passwordValid(): boolean {
  if (passwordForm.oldPassword === '' || passwordForm.newPassword === '' || passwordForm.confirm === '') {
    ElMessage.warning('请完整填写旧密码、新密码与确认密码');
    return false;
  }
  if (passwordForm.newPassword.length < 8) {
    ElMessage.error('新密码最短 8 位（强度基线同注册）');
    return false;
  }
  if (passwordForm.newPassword !== passwordForm.confirm) {
    ElMessage.error('两次输入的新密码不一致');
    return false;
  }
  return true;
}

async function onChangePassword(): Promise<void> {
  if (!passwordValid()) {
    return;
  }
  changingPassword.value = true;
  try {
    await authApi.changePassword(passwordForm.oldPassword, passwordForm.newPassword);
    // 成功：服务端已吊销全部 refresh 会话 → 清本地凭据并回登录页
    ElMessage.success('密码已修改，已吊销所有会话，请重新登录');
    clearAuth();
    passwordForm.oldPassword = '';
    passwordForm.newPassword = '';
    passwordForm.confirm = '';
    void router.push('/login');
  } catch (e) {
    handleError(e, '修改密码失败');
  } finally {
    changingPassword.value = false;
  }
}

onMounted(() => {
  void fetchAll();
});
</script>

<template>
  <el-card v-loading="loading">
    <template #header><span>设置管理</span></template>
    <el-alert type="info" :closable="false" class="boundary-note">
      本页仅管理运行态设置（site_setting 表）。启动配置（如 Mizuki 项目根路径、运行模式）在初始化向导设定，不在此修改。Mizuki 侧 config/主题配置文件接管属二期能力。
    </el-alert>

    <el-divider content-position="left">修改密码</el-divider>
    <el-form label-width="200px" class="password-form">
      <el-form-item label="旧密码">
        <el-input v-model="passwordForm.oldPassword" type="password" show-password autocomplete="current-password" />
      </el-form-item>
      <el-form-item label="新密码（最短 8 位）">
        <el-input v-model="passwordForm.newPassword" type="password" show-password autocomplete="new-password" />
      </el-form-item>
      <el-form-item label="确认新密码">
        <el-input v-model="passwordForm.confirm" type="password" show-password autocomplete="new-password" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="changingPassword" @click="onChangePassword">修改密码</el-button>
        <span class="password-hint">修改成功后将吊销所有会话，需要重新登录</span>
      </el-form-item>
    </el-form>

    <div v-for="group in grouped" :key="group.group" class="setting-group">
      <el-divider content-position="left">{{ group.label }}</el-divider>
      <el-form label-width="200px">
        <el-form-item v-for="item in group.items" :key="item.key" :label="item.key">
          <el-switch
            v-if="valueTypeOf(item.value) === 'boolean'"
            v-model="item.text"
            active-value="true"
            inactive-value="false"
          />
          <el-input
            v-else-if="valueTypeOf(item.value) === 'object'"
            v-model="item.text"
            type="textarea"
            :rows="4"
          />
          <el-input v-else v-model="item.text" />
          <el-button
            size="small"
            type="primary"
            :loading="saving === item.key"
            :disabled="item.text === item.original"
            @click="onSave(item)"
          >保存</el-button>
          <el-button size="small" type="danger" @click="onDelete(item)">删除</el-button>
          <div v-if="item.parseError" class="parse-error">JSON 错误：{{ item.parseError }}</div>
        </el-form-item>
      </el-form>
    </div>

    <el-divider content-position="left">新增设置项</el-divider>
    <el-form label-width="200px">
      <el-form-item label="key">
        <el-input v-model="newKey" placeholder="如 site.title" />
      </el-form-item>
      <el-form-item label="value（JSON 或文本）">
        <el-input v-model="newValue" placeholder='如 "我的博客" 或 {"a":1}' />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="onAdd">新增</el-button>
      </el-form-item>
    </el-form>
  </el-card>
</template>

<style scoped>
.boundary-note {
  margin-bottom: 16px;
}
.setting-group {
  margin-bottom: 12px;
}
.parse-error {
  color: var(--el-color-danger);
  font-size: 12px;
  width: 100%;
}
.password-form {
  max-width: 520px;
}
.password-hint {
  margin-left: 12px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
