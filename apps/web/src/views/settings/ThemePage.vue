<script setup lang="ts">
/**
 * [主题外观] 面板主题管理页
 * [职责] 纯前端自包含（零后端端点、零 Mizuki 主题文件写入）：
 *  - 预设主题画廊（4 套程序化主色阶，点击即生效）+「恢复默认」（樱花粉内置）；
 *  - 用户自定义主题：上传 .css 文件（FileReader 读文本）或直接在编辑器粘贴，
 *    保存进 localStorage（上限 20 个 / 单条 200KB，防御见 lib/custom-theme.ts）；
 *  - 激活态持久化 localStorage（mizuki.customTheme.active），
 *    注入 <style id="mizuki-custom-theme-style"> 覆盖 --el-color-primary 系列与
 *    --mizuki-* 变量（明暗两套）。
 * [状态] ACTIVE
 */
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  type CustomThemeItem,
  MAX_CSS_LENGTH,
  MAX_CUSTOM_THEMES,
  PRESET_THEMES,
  deleteCustomTheme,
  generatePresetCss,
  getActiveThemeId,
  listCustomThemes,
  saveCustomTheme,
  setActiveTheme,
} from '../../lib/custom-theme';

/** 激活 id 响应式镜像（null = 内置默认樱花粉） */
const activeId = ref<string | null>(null);
const customThemes = ref<CustomThemeItem[]>([]);

// ── 编辑器态 ──
const editingId = ref<string | null>(null); // null = 新建；非 null = 编辑既有条目
const editingName = ref('');
const editingCss = ref('');
const saving = ref(false);

const isEditing = computed(() => editingId.value !== null);
const cssOverLimit = computed(() => editingCss.value.length > MAX_CSS_LENGTH);

/** 预设卡片预览 CSS（仅展示用：小色板内联 style） */
function presetSwatch(preset: (typeof PRESET_THEMES)[number]): { light: string; dark: string } {
  return { light: preset.primary, dark: preset.darkPrimary };
}

function refresh(): void {
  activeId.value = getActiveThemeId();
  customThemes.value = listCustomThemes();
}

onMounted(refresh);

// ── 预设操作 ──

function applyPreset(id: string): void {
  try {
    setActiveTheme(id);
    activeId.value = id;
    ElMessage.success('预设主题已生效');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '应用预设失败');
  }
}

async function restoreDefault(): Promise<void> {
  try {
    await ElMessageBox.confirm('恢复内置默认主题（樱花粉）？当前自定义样式将被停用（条目保留）。', '恢复默认', {
      type: 'warning',
    });
  } catch {
    return;
  }
  setActiveTheme(null);
  activeId.value = null;
  ElMessage.success('已恢复内置默认主题');
}

// ── 自定义主题编辑 ──

function startNew(): void {
  editingId.value = null;
  editingName.value = '';
  editingCss.value = '';
}

function startEdit(item: CustomThemeItem): void {
  editingId.value = item.id;
  editingName.value = item.name;
  editingCss.value = item.css;
}

function startFromPreset(id: string): void {
  const preset = PRESET_THEMES.find((p) => p.id === id);
  if (preset === undefined) return;
  editingId.value = null;
  editingName.value = `${preset.name}（副本）`;
  editingCss.value = generatePresetCss(preset);
}

async function onUploadCss(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file === undefined) return;
  input.value = ''; // 允许重复选择同一文件
  if (!file.name.toLowerCase().endsWith('.css')) {
    ElMessage.error('仅支持 .css 文件');
    return;
  }
  if (file.size > MAX_CSS_LENGTH) {
    ElMessage.error(`文件超过上限（${MAX_CSS_LENGTH} 字节）`);
    return;
  }
  try {
    const text = await file.text();
    if (editingId.value === null && editingName.value.trim() === '') {
      editingName.value = file.name.replace(/\.css$/i, '').slice(0, 50);
    }
    editingCss.value = text;
    ElMessage.success('已载入 CSS 文件，检查后点击保存');
  } catch (e) {
    ElMessage.error(`读取文件失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

async function onSave(): Promise<void> {
  saving.value = true;
  try {
    const item = saveCustomTheme({
      id: editingId.value ?? undefined,
      name: editingName.value,
      css: editingCss.value,
    });
    refresh();
    editingId.value = item.id;
    editingName.value = item.name;
    editingCss.value = item.css;
    ElMessage.success('自定义主题已保存');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

function onSaveAndApply(): Promise<void> {
  return onSave().then(() => {
    if (editingId.value !== null) applyCustom(editingId.value);
  });
}

function applyCustom(id: string): void {
  try {
    setActiveTheme(id);
    activeId.value = id;
    ElMessage.success('自定义主题已生效');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '应用失败');
  }
}

async function onDelete(item: CustomThemeItem): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除自定义主题「${item.name}」？`, '删除确认', { type: 'warning' });
  } catch {
    return;
  }
  deleteCustomTheme(item.id);
  if (editingId.value === item.id) startNew();
  refresh();
  ElMessage.success('已删除');
}
</script>

<template>
  <div class="theme-page">
    <el-alert type="info" :closable="false" class="scope-note" show-icon>
      <template #title>
        本页主题仅作用于管理面板自身（浏览器本地生效，不写入博客主题文件，不受主题漂移门禁影响）。
      </template>
    </el-alert>

    <!-- ── 内置预设 ── -->
    <el-card class="panel-card section">
      <template #header>
        <div class="section-head">
          <span>预设主题</span>
          <el-button size="small" :type="activeId === null ? 'primary' : 'default'" @click="restoreDefault">
            内置默认（樱花粉）
          </el-button>
        </div>
      </template>
      <div class="preset-grid">
        <div
          v-for="preset in PRESET_THEMES"
          :key="preset.id"
          class="preset-card"
          :class="{ active: activeId === preset.id }"
        >
          <div class="swatch-row">
            <span class="swatch" :style="{ background: presetSwatch(preset).light }" title="亮色主色" />
            <span class="swatch dark" :style="{ background: presetSwatch(preset).dark }" title="暗色主色" />
          </div>
          <div class="preset-name">
            {{ preset.name }}
            <el-tag v-if="activeId === preset.id" size="small" type="success">使用中</el-tag>
          </div>
          <div class="preset-desc">{{ preset.description }}</div>
          <!-- 卡片本身不是控件：两个动作各自是真实按钮，避免 role=button 吞掉内层可访问控件 -->
          <div class="preset-actions">
            <el-button
              size="small"
              :type="activeId === preset.id ? 'default' : 'primary'"
              :disabled="activeId === preset.id"
              @click="applyPreset(preset.id)"
            >
              应用
            </el-button>
            <el-button size="small" text type="primary" @click="startFromPreset(preset.id)">
              以此为基础自定义
            </el-button>
          </div>
        </div>
      </div>
    </el-card>

    <!-- ── 自定义主题列表 ── -->
    <el-card class="panel-card section">
      <template #header>
        <div class="section-head">
          <span>
            我的自定义主题
            <span class="count-hint">（{{ customThemes.length }}/{{ MAX_CUSTOM_THEMES }}）</span>
          </span>
          <el-button size="small" type="primary" @click="startNew">新建空白主题</el-button>
        </div>
      </template>
      <el-empty v-if="customThemes.length === 0" description="还没有自定义主题，上传 CSS 文件或从预设副本开始" />
      <div v-else class="custom-list">
        <div
          v-for="item in customThemes"
          :key="item.id"
          class="custom-item"
          :class="{ active: activeId === item.id }"
        >
          <div class="custom-info">
            <div class="custom-name">
              {{ item.name }}
              <el-tag v-if="activeId === item.id" size="small" type="success">使用中</el-tag>
            </div>
            <div class="custom-meta">
              {{ new Date(item.updatedAt).toLocaleString() }} · {{ item.css.length }} 字符
            </div>
          </div>
          <div class="custom-actions">
            <el-button v-if="activeId !== item.id" size="small" type="primary" plain @click="applyCustom(item.id)">
              应用
            </el-button>
            <el-button size="small" @click="startEdit(item)">编辑</el-button>
            <el-button size="small" type="danger" plain @click="onDelete(item)">删除</el-button>
          </div>
        </div>
      </div>
    </el-card>

    <!-- ── 编辑器 ── -->
    <el-card class="panel-card section">
      <template #header>
        <div class="section-head">
          <span>{{ isEditing ? `编辑：${editingName || '未命名'}` : '新建自定义主题' }}</span>
          <label class="upload-label">
            <input type="file" accept=".css,text/css" class="upload-input" @change="onUploadCss" />
            <el-button size="small" tag="span">上传 CSS 文件</el-button>
          </label>
        </div>
      </template>
      <el-form label-width="90px">
        <el-form-item label="主题名称">
          <el-input
            v-model="editingName"
            placeholder="如：我的深夜蓝"
            maxlength="50"
            show-word-limit
            class="name-input"
          />
        </el-form-item>
        <el-form-item label="CSS 内容">
          <div class="css-editor-wrap">
            <el-input
              v-model="editingCss"
              type="textarea"
              :rows="14"
              placeholder=":root {&#10;  --mizuki-primary: #3eb489;&#10;  --el-color-primary-light-3: #79ccb1;&#10;  /* …可覆盖任意 --el-* 与 --mizuki-* 变量 */&#10;}&#10;&#10;html.dark {&#10;  --mizuki-primary: #5fc7a2;&#10;}"
            />
            <div class="css-hint">
              <span v-if="cssOverLimit" class="over-limit">
                已超上限：{{ editingCss.length }}/{{ MAX_CSS_LENGTH }} 字符
              </span>
              <span v-else>{{ editingCss.length }}/{{ MAX_CSS_LENGTH }} 字符</span>
              · 变量作用与算法同 Element Plus 官方（light-N 混白、暗色混 #141414）；保存到浏览器本地，仅本机生效
            </div>
          </div>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="saving" :disabled="cssOverLimit" @click="onSave">保存</el-button>
          <el-button type="primary" class="btn-gradient-primary" :loading="saving" :disabled="cssOverLimit" @click="onSaveAndApply">保存并应用</el-button>
          <el-button v-if="isEditing" @click="startNew">转为新建</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.theme-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.scope-note {
  border-radius: var(--mizuki-radius-control);
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.count-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: normal;
}

/* 预设画廊 */
.preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}
.preset-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--mizuki-border-hairline);
  border-radius: var(--mizuki-radius-card);
  padding: 16px;
  transition: border-color var(--mizuki-motion-fast) ease,
              box-shadow var(--mizuki-motion-fast) ease,
              transform var(--mizuki-motion-fast) var(--mizuki-motion-spring);
  background: var(--el-bg-color);
}
.preset-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--mizuki-lift-shadow);
  border-color: var(--el-color-primary-light-7);
}
.preset-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: auto;
  padding-top: 12px;
}
.preset-card.active {
  border-color: var(--el-color-primary);
  box-shadow: var(--mizuki-card-shadow);
}
.swatch-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.swatch {
  width: 42px;
  height: 42px;
  border-radius: var(--mizuki-radius-control);
  display: inline-block;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
}
.swatch.dark {
  outline: 1px solid var(--el-border-color);
}
.preset-name {
  font-weight: 600;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.preset-desc {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-bottom: 6px;
}

/* 自定义列表 */
.custom-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.custom-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--mizuki-radius-control);
  padding: 10px 14px;
  transition: border-color 150ms ease;
}
.custom-item.active {
  border-color: var(--el-color-primary);
}
.custom-name {
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}
.custom-meta {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-top: 2px;
}
.custom-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

/* 编辑器 */
.upload-label {
  cursor: pointer;
}
.upload-input {
  display: none;
}
.name-input {
  max-width: 320px;
}
.css-editor-wrap {
  width: 100%;
}
.css-hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.over-limit {
  color: var(--el-color-danger);
  font-weight: 600;
}
</style>
