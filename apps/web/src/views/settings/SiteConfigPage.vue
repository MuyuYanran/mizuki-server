<script setup lang="ts">
/**
 * [Phase3-C7] 站点配置页（override 批，ADR-020）
 * [职责] 受控子集管理：siteConfig.lang（语言（可选），C5 面板形态同型：
 *   placeholder 'en'、空 = 站点默认不落键）+ commentConfig 表单（schema-form
 *   驱动，字段面对齐主题类型定义零删减；commentConfig 无真 secret 键 → 无脱敏
 *   语义，T1.1 结论）。一页一查一存：GET /admin/config 整体读，保存经
 *   PUT lang + PUT comments 分立写。
 * [边界] 仅受控子集；其余 config.ts 字段不在面板管理面（.strict() 兜底禁蔓延）；
 *   保存后需经「构建预览」执行 build 任务才反映到站点 dist（生效链）。
 */
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { ZodObject, ZodType } from 'zod';
import { CommentConfigSchema, MizukiTier1Profile, SITE_LANG_PATTERN } from '@mizuki/shared';
import { configApi } from '../../api/config';
import { ApiError } from '../../api/http';
import { SchemaForm, emptyValueFromSchema } from '../../lib/schema-form';
import { notifyApiError } from '../../lib/notify';

const loading = ref(false);
const saving = ref(false);
/** 语言（可选）：'' = 未设置（站点默认）；回显 override 态，基线值仅作对照展示 */
const lang = ref('');
/**
 * [Phase4-D4/配套2] 语言输入改 el-select（allow-create）：选项源 = Tier1 档案
 * i18nSupport.siteLangUnion（T1.3 主题根实测支持集）；allow-create 保留连字符形
 * 等档案外合法值入口（siteLangSchema [-_] 双兼容为权威，选择器仅为体验层）。
 */
const langOptions: string[] = MizukiTier1Profile.i18nSupport?.siteLangUnion ?? [];
const baselineLang = ref<string | null>(null);
const baselineUnavailable = ref(false);
const formValue = ref<Record<string, unknown>>(emptyValueFromSchema(CommentConfigSchema as ZodObject<Record<string, ZodType>>));

// ── [Phase4-D3] 导航管理（#8，T1.5 决策 = JSON textarea 兜底，C2b links 先例同构） ──
/** 导航 JSON 文本（links 数组本体；初值 override 优先，否则基线，均无 = 空表单起步） */
const navJson = ref('[]');
/** 基线 nav 对照文本（不可得 → null） */
const baselineNavText = ref<string | null>(null);
/** 基线不可得（真实主题 navbar 含 LinkPreset 标识符 → 降级分支，ADR-020 追加节） */
const navBaselineUnavailable = ref(false);

/** 页面级标签覆盖（[Phase3-C7] describeSchema labels 参数；不污染全局覆盖表） */
const CONFIG_LABELS: Record<string, string> = {
  enable: '启用评论',
  system: '评论系统',
  twikoo: 'Twikoo 配置',
  giscus: 'Giscus 配置',
  envId: '服务地址（envId）',
  region: '区域（region）',
  lang: '语言',
  repo: '仓库（repo）',
  repoId: '仓库 ID（repoId）',
  category: '分类（category）',
  categoryId: '分类 ID（categoryId）',
  mapping: '关联方式（mapping）',
  strict: '严格模式（strict）',
  reactionsEnabled: '表情反应开关',
  emitMetadata: '元数据上报',
  inputPosition: '输入框位置',
  theme: '主题配色',
  loading: '加载方式',
};

async function fetchConfig(): Promise<void> {
  loading.value = true;
  try {
    const view = await configApi.getConfig();
    lang.value = view.siteConfig.lang ?? '';
    baselineLang.value = view.siteConfig.baselineLang;
    // 基线不可得（config.ts 缺声明/含未支持节点）→ 空表单起步（ADR-020 已知限制）
    baselineUnavailable.value = view.commentConfig === null;
    formValue.value =
      (view.commentConfig as Record<string, unknown> | null) ??
      emptyValueFromSchema(CommentConfigSchema as ZodObject<Record<string, ZodType>>);
    // [Phase4-D3] nav：override 优先回显，否则基线对照，均不可得 = 空表单起步
    navBaselineUnavailable.value = view.baselineNav === null;
    navJson.value = JSON.stringify(view.nav?.links ?? [], null, 2);
    baselineNavText.value = view.baselineNav ? JSON.stringify(view.baselineNav.links, null, 2) : null;
  } catch (e) {
    notifyApiError(e, '加载站点配置失败');
  } finally {
    loading.value = false;
  }
}

/**
 * 可选键空串归一为不落键（面板语义：空 = 未设置，与 C5 面板同型）——
 * 必填键（enable/envId/giscus 12 键）原样提交，空串即用户显式输入。
 */
function normalizeComments(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...value };
  if (out['system'] === '') {
    delete out['system'];
  }
  if (typeof out['twikoo'] === 'object' && out['twikoo'] !== null) {
    const twikoo = { ...(out['twikoo'] as Record<string, unknown>) };
    if (twikoo['region'] === '') {
      delete twikoo['region'];
    }
    if (twikoo['lang'] === '') {
      delete twikoo['lang'];
    }
    out['twikoo'] = twikoo;
  }
  return out;
}

async function onSubmit(value: Record<string, unknown>): Promise<void> {
  // [Phase4-D4/S2/A4b] 清除意图防吞：el-select clearable 实证经 useEmptyValues 发
  // undefined（DEFAULT_VALUE_ON_CLEAR = void 0），@clear 兜底为 ''，此处再 ?? '' 收口——
  // 保证任何空值路径（undefined/null）都归一为''清除指令，且 lang 校验仅作用于非空值
  // （空值直达 putLang，禁被表单校验/空值省略吞掉）。线上清除契约 = ''（PutLangBodySchema
  // 的 siteLangSchema 对 null 恒 400，e2e p7f ⑭ 权威），不发 null。
  const langTrim = (lang.value ?? '').trim();
  if (langTrim !== '' && !SITE_LANG_PATTERN.test(langTrim)) {
    ElMessage.warning('语言仅允许字母数字，以连字符或下划线分段（如 en / zh-Hans / zh_CN）');
    return;
  }
  saving.value = true;
  try {
    await configApi.putLang(langTrim);
    await configApi.putComments(normalizeComments(value));
    ElMessage.success('站点配置已保存；如需反映到站点请在「构建预览」执行 build');
    await fetchConfig();
  } catch (e) {
    notifyApiError(e, '保存站点配置失败');
  } finally {
    saving.value = false;
  }
}

/**
 * [Phase4-D3] 导航 JSON 输入守卫（零 any）：解析失败 / 非数组 / 元素非对象 → null
 * （字段级形状校验由服务端 zod .strict() 权威兜底，400 issues 回显——C2b 同构口径）。
 */
function parseNavInput(text: string): Record<string, unknown>[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  const items: Record<string, unknown>[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return null;
    }
    items.push(item as Record<string, unknown>);
  }
  return items;
}

/** 保存导航：空数组 = 合法清空导航（破坏性语义，二次确认）；其余交服务端校验 */
async function onSaveNav(): Promise<void> {
  const links = parseNavInput(navJson.value);
  if (links === null) {
    ElMessage.warning('导航内容须为 JSON 数组（元素为对象），请检查格式');
    return;
  }
  if (links.length === 0) {
    const confirmed = await ElMessageBox.confirm(
      '将保存空导航：前台导航栏将被清空（构建预览执行 build 后生效）。确定继续？',
      '空导航二次确认',
      { type: 'warning', confirmButtonText: '确认清空', cancelButtonText: '取消' },
    )
      .then(() => true)
      .catch(() => false);
    if (!confirmed) {
      return;
    }
  }
  saving.value = true;
  try {
    await configApi.putNav(links);
    ElMessage.success('导航已保存；如需反映到站点请在「构建预览」执行 build');
    await fetchConfig();
  } catch (e) {
    notifyApiError(e, '保存导航失败');
  } finally {
    saving.value = false;
  }
}

/** 还原主题默认导航：links 缺键 = 清除 override（config.ts 还原留档原文本；无 override 时服务端 no-op） */
async function onResetNav(): Promise<void> {
  saving.value = true;
  try {
    await configApi.putNav(undefined);
    ElMessage.success('已还原主题默认导航（清除面板管理）');
    await fetchConfig();
  } catch (e) {
    notifyApiError(e, '还原导航失败');
  } finally {
    saving.value = false;
  }
}


onMounted(() => {
  void fetchConfig();
});
</script>

<template>
  <div v-loading="loading">
    <h2>站点配置</h2>
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="受控子集：站点语言与评论配置"
      description="仅管理主题 config.ts 的 siteConfig.lang 与 commentConfig，其余字段不受影响；commentConfig 值为公开性质（随构建烘入站点前端，无敏感键）。保存后请在「构建预览」执行 build 任务使站点生效。"
      class="page-alert"
    />
    <el-form label-width="140px" class="lang-form">
      <el-form-item label="语言">
        <!-- [Phase4-D4/配套2] el-select（allow-create + filterable + clearable）：
             选项 = 主题实测支持集；自行输入保留（schema 双兼容为权威）；清空 = 站点默认 -->
        <el-select
          v-model="lang"
          placeholder="en"
          allow-create
          filterable
          default-first-option
          clearable
          class="lang-input"
          @clear="lang = ''"
        >
          <el-option v-for="code in langOptions" :key="code" :label="code" :value="code" />
        </el-select>
        <div class="field-help">
          可选；空 = 站点默认（当前基线：{{ baselineLang ?? '未知' }}），可从常用语言选择或自行输入（连字符/下划线分段由服务端校验）
        </div>
      </el-form-item>
    </el-form>
    <el-alert
      v-if="baselineUnavailable"
      type="warning"
      :closable="false"
      show-icon
      title="评论配置基线不可得"
      description="主题 config.ts 缺 commentConfig 声明或含未支持的写法，表单以空值起步；填写全量字段保存后即由面板接管。"
      class="page-alert"
    />
    <SchemaForm
      :schema="CommentConfigSchema as ZodObject<Record<string, ZodType>>"
      :model-value="formValue"
      :labels="CONFIG_LABELS"
      :loading="saving"
      submit-label="保存站点配置"
      @update:model-value="(v: Record<string, unknown>) => (formValue = v)"
      @submit="onSubmit"
      @cancel="fetchConfig"
    />

    <!-- [Phase4-D3] 导航管理区（#8；JSON textarea 兜底，C2b links 先例同构） -->
    <el-divider content-position="left">导航管理</el-divider>
    <el-alert
      v-if="navBaselineUnavailable"
      type="warning"
      :closable="false"
      show-icon
      title="导航基线不可得"
      description="主题 config.ts 的 navBarConfig 含预设标识符（LinkPreset）等未支持写法，基线无法解析为可编辑数据；编辑器以空表单起步，首次保存即由面板接管（保存前原文已留档，可随时还原）。"
      class="page-alert"
    />
    <div class="nav-help">
      以 JSON 数组编辑导航项：每项含 <code>name</code>（必填，≤64 字）、<code>url</code>（必填，≤512
      字符，仅支持 http/https、/ 开头站内路径、#）；可选 <code>icon</code>（iconify 标识符，≤128）、
      <code>external</code>（布尔）、<code>children</code>（子菜单，最多一层）。
    </div>
    <el-input
      v-model="navJson"
      type="textarea"
      :rows="14"
      spellcheck="false"
      class="nav-textarea"
      aria-label="导航 JSON"
    />
    <div class="nav-actions">
      <el-button type="primary" :loading="saving" @click="onSaveNav">保存导航</el-button>
      <el-button :loading="saving" @click="onResetNav">还原主题默认</el-button>
    </div>
    <el-collapse v-if="baselineNavText" class="nav-baseline">
      <el-collapse-item title="主题默认导航（基线对照，只读）">
        <pre class="nav-baseline-pre">{{ baselineNavText }}</pre>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<style scoped>
.page-alert {
  margin-bottom: 16px;
}
.lang-form {
  margin-bottom: 8px;
}
.lang-input {
  max-width: 240px;
}
.field-help {
  width: 100%;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
.nav-help {
  margin-bottom: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
.nav-help code {
  padding: 0 4px;
  border-radius: var(--el-border-radius-small);
  background: var(--el-fill-color-light);
}
.nav-textarea {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}
.nav-actions {
  margin-top: 8px;
}
.nav-baseline {
  margin-top: 12px;
}
.nav-baseline-pre {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
