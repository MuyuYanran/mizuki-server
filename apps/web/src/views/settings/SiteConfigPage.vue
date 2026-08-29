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
import { ElMessage } from 'element-plus';
import type { ZodObject, ZodType } from 'zod';
import { CommentConfigSchema, LANG_CODE_PATTERN } from '@mizuki/shared';
import { configApi } from '../../api/config';
import { ApiError } from '../../api/http';
import { SchemaForm, emptyValueFromSchema } from '../../lib/schema-form';

const loading = ref(false);
const saving = ref(false);
/** 语言（可选）：'' = 未设置（站点默认）；回显 override 态，基线值仅作对照展示 */
const lang = ref('');
const baselineLang = ref<string | null>(null);
const baselineUnavailable = ref(false);
const formValue = ref<Record<string, unknown>>(emptyValueFromSchema(CommentConfigSchema as ZodObject<Record<string, ZodType>>));

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
  } catch (e) {
    handleError(e, '加载站点配置失败');
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
  const langTrim = lang.value.trim();
  if (langTrim !== '' && !LANG_CODE_PATTERN.test(langTrim)) {
    ElMessage.warning('语言仅允许字母数字与连字符分段（BCP-47 简码，如 en / zh-Hant）');
    return;
  }
  saving.value = true;
  try {
    await configApi.putLang(langTrim);
    await configApi.putComments(normalizeComments(value));
    ElMessage.success('站点配置已保存；如需反映到站点请在「构建预览」执行 build');
    await fetchConfig();
  } catch (e) {
    handleError(e, '保存站点配置失败');
  } finally {
    saving.value = false;
  }
}

function handleError(e: unknown, fallback: string): void {
  if (e instanceof ApiError) {
    ElMessage.error(e.message);
  } else {
    ElMessage.error(fallback);
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
        <el-input v-model="lang" placeholder="en" class="lang-input" />
        <div class="field-help">
          可选；空 = 站点默认（当前基线：{{ baselineLang ?? '未知' }}），BCP-47 简码由服务端校验
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
</style>
