<script setup lang="ts">
/**
 * [P10b] zod schema 驱动表单渲染器
 * [职责] 接收 zod schema + modelValue，按 describeSchema 推导的字段描述符
 *   渲染 Element Plus 控件；提交前用同一份 schema 在浏览器端 parse 一次，
 *   错误逐字段提示；后端 400 校验错误（detail.issues）也映射到字段。
 * [状态] ACTIVE
 *
 * 渲染策略：自写映射器（ADR-007），不引入 zod-to-json-schema 中间层。
 * 字段类型→控件映射见 mapper.ts；此处只负责渲染与校验编排。
 *
 * [Phase2-B1]
 * - R2-9：date 控件挂 el-date-picker（YYYY-MM-DD；清空回调 null → undefined，
 *   与 zod optional 语义对齐）；
 * - R2-12：description 渲染为字段下方灰字帮助文案；
 * - R2-13：必填字段标签挂 FieldHint 问号 tooltip（文案同源 description，
 *   未配置回落通用必填提示；与帮助文案不重复措辞——同一文案二处呈现）。
 */
import { computed, ref, watch } from 'vue';
import type { z, ZodObject, ZodType } from 'zod';
import { describeSchema, validateBySchema, hasStringId, type FieldDescriptor } from './mapper';
import FieldHint from '../../components/FieldHint.vue';

const props = defineProps<{
  /** zod schema（ZodObject），字段规格唯一来源 */
  schema: ZodObject<Record<string, ZodType>>;
  /** 双向绑定的表单值（父组件持有，提交时由父取走） */
  modelValue: Record<string, unknown>;
  /** 提交按钮文案（新增/编辑场景区分） */
  submitLabel?: string;
  /** 提交中状态（父控制 loading） */
  loading?: boolean;
  /** 后端返回的字段错误（detail.issues 映射后） */
  serverErrors?: Record<string, string>;
  /** [Phase3-C7] 页面级标签覆盖（键名 → 显示文案），透传 describeSchema */
  labels?: Record<string, string>;
  /** [Phase4-D4/B3] 新增态允许编辑 id（仅对 string id 集合生效；编辑态父传 false 保持只读） */
  idEditable?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: Record<string, unknown>): void;
  (e: 'submit', value: Record<string, unknown>): void;
  (e: 'cancel'): void;
}>();

const descriptors = computed<FieldDescriptor[]>(() => describeSchema(props.schema, props.labels));

/** [Phase4-D4/B3] id 可编辑生效条件：父允许 + string id 集合（number id 恒自动生成保持只读） */
const editableId = computed(() => (props.idEditable ?? false) && hasStringId(props.schema));

/** 本地校验错误（schema.parse 在浏览器端跑一次） */
const localErrors = ref<Record<string, string>>({});

/** 合并本地 + 后端错误（后端优先，已通过前端校验则后端为权威） */
const fieldErrors = computed<Record<string, string>>(() => ({
  ...localErrors.value,
  ...(props.serverErrors ?? {}),
}));

/** 输入更新：双向绑定透传父组件 */
function updateField(key: string, value: unknown): void {
  const next = { ...props.modelValue, [key]: value };
  emit('update:modelValue', next);
}

/** [C2b] 对象数组（timeline.links）JSON 文本框：草稿文本与解析状态 */
const JSON_PLACEHOLDER = 'JSON 数组文本，如 [{"name":"官网","url":"https://…","type":"website"}]';
const jsonDrafts = ref<Record<string, string | undefined>>({});

/** 渲染值：无效 JSON 编辑中保留草稿原文，其余序列化现值 */
function jsonTextOf(field: FieldDescriptor): string {
  const draft = jsonDrafts.value[field.key];
  if (draft !== undefined) {
    return draft;
  }
  return JSON.stringify((props.modelValue[field.key] as unknown) ?? [], null, 2);
}

/** JSON 文本提交：解析为数组才更新字段；失败保留草稿并提示。
 * [Phase4-D4e/E1] 归一化移出 input（与 C5 tags 同病同治）：原实现在 input 即
 * JSON.parse——合法中间态（如 `[]`、`["a"]` 闭合瞬间）立即 emit → stringify 回显
 * reformat 打断输入（缩进改写/光标跳动）；非法中间态红错逐键闪烁。改为 input 透传
 * 草稿、blur/提交才解析归一。 */
function onJsonInput(field: FieldDescriptor, text: string): void {
  jsonDrafts.value = { ...jsonDrafts.value, [field.key]: text };
}

/** [Phase4-D4e/E1] blur 才解析归一：成功 emit + 清草稿；失败保留草稿 + 报错 */
function onJsonBlur(field: FieldDescriptor): void {
  const draft = jsonDrafts.value[field.key];
  if (draft === undefined) {
    return;
  }
  try {
    const parsed = JSON.parse(draft) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('not an array');
    }
    jsonDrafts.value = { ...jsonDrafts.value, [field.key]: undefined };
    localErrors.value = { ...localErrors.value, [field.key]: '' };
    updateField(field.key, parsed);
  } catch {
    localErrors.value = { ...localErrors.value, [field.key]: 'JSON 数组解析失败' };
  }
}

/** [Phase4-D4e/E1] 提交兜底：未 blur 的 JSON 草稿解析归一（失败字段键返回 failedKeys 由调用方挂错阻断） */
function normalizePendingJsonDrafts(value: Record<string, unknown>): {
  value: Record<string, unknown>;
  failedKeys: string[];
} {
  const pending = Object.entries(jsonDrafts.value).filter(([, d]) => d !== undefined);
  if (pending.length === 0) {
    return { value, failedKeys: [] };
  }
  const next = { ...value };
  const failedKeys: string[] = [];
  const cleared = { ...jsonDrafts.value };
  for (const [key, draft] of pending) {
    try {
      const parsed = JSON.parse(draft as string) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error('not an array');
      }
      next[key] = parsed;
      cleared[key] = undefined;
    } catch {
      failedKeys.push(key);
      localErrors.value = { ...localErrors.value, [key]: 'JSON 数组解析失败' };
    }
  }
  jsonDrafts.value = cleared;
  return { value: next, failedKeys };
}

/** [Phase4-D4/A5] 字符串数组（tags-text）草稿原文与本组件最近 emit 值 */
const arrayDrafts = ref<Record<string, string | undefined>>({});
const lastEmitted: Record<string, unknown> = {};

/** 渲染文本：草稿原文优先（防 emit 回写规范化改写输入），否则 join 回显（编辑态数据源） */
function arrayTextOf(field: FieldDescriptor): string {
  const draft = arrayDrafts.value[field.key];
  if (draft !== undefined) {
    return draft;
  }
  const current = props.modelValue[field.key];
  return Array.isArray(current) ? (current as string[]).join('、') : '';
}

/** [C5] 归一化：逗号/中文逗号/顿号分隔 → split（trim + 滤空段）；空文本 → 空数组 */
function normalizeArrayText(text: string): string[] {
  return text
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/**
 * [Phase4-D4/C5] input 透传原值：仅存草稿，不 split、不 emit（归一化移出 input）。
 * 原实现（A5）在 input 即数组化 emit → modelValue 每键更新 → watch 清草稿判定
 * `nv[key] !== lastEmitted[key]` 在 reactive 代理数组 vs raw 数组上恒真 → 草稿
 * 每键被清 → join 回显吃掉分隔符（用户真机复现：逐键输入顿号/逗号无法进入输入框；
 * fill 整串一次成型掩盖——C5 二分探针实锤：type '甲,' → 输入框 '甲'）。
 */
function onArrayInput(field: FieldDescriptor, text: string): void {
  arrayDrafts.value = { ...arrayDrafts.value, [field.key]: text };
}

/** [Phase4-D4/C5] blur 才归一：split → trim → 滤空段 → 数组化 emit → 清草稿（join 回显归一结果） */
function onArrayBlur(field: FieldDescriptor): void {
  const draft = arrayDrafts.value[field.key];
  if (draft === undefined) {
    return;
  }
  const parts = normalizeArrayText(draft);
  arrayDrafts.value = { ...arrayDrafts.value, [field.key]: undefined };
  lastEmitted[field.key] = parts;
  updateField(field.key, parts);
}

/**
 * 外部数据替换（非本组件 emit 回写，如打开编辑抽屉载入他条）→ 清草稿回显新值。
 * [Phase4-D4/C5] 比对改**值语义**（JSON.stringify 深比较）：reactive 代理数组与
 * lastEmitted 持有的 raw 数组 `!==` 恒真（原引用比对失效致草稿每键被清），禁用。
 * input 期间 modelValue 不再变化（onArrayInput 不 emit），本 watch 仅服务 blur 后
 * 回写（draft 已清，skip）与外部替换（清草稿回显新值）两态。
 */
watch(
  () => props.modelValue,
  (nv) => {
    for (const key of Object.keys(arrayDrafts.value)) {
      const draft = arrayDrafts.value[key];
      if (draft === undefined) {
        continue;
      }
      const expected = lastEmitted[key] ?? normalizeArrayText(draft);
      if (JSON.stringify(nv[key]) !== JSON.stringify(expected)) {
        arrayDrafts.value = { ...arrayDrafts.value, [key]: undefined };
      }
    }
  },
);

/** 嵌套对象字段更新 */
function updateNestedField(parentKey: string, childKey: string, value: unknown): void {
  const parent = (props.modelValue[parentKey] ?? {}) as Record<string, unknown>;
  const nextParent = { ...parent, [childKey]: value };
  updateField(parentKey, nextParent);
}

/** [R2-9] 日期更新：清空（null）归一为 undefined（zod optional 语义） */
function updateDateField(field: FieldDescriptor, value: unknown): void {
  updateField(field.key, value ?? undefined);
}

/** 标签输入（tags）：回车追加，Backspace 在空输入时删尾 */
function onTagEnter(e: KeyboardEvent, field: FieldDescriptor): void {
  const input = e.target as HTMLInputElement;
  const value = input.value.trim();
  if (value === '') {
    return;
  }
  const current = (props.modelValue[field.key] as string[] | undefined) ?? [];
  if (!current.includes(value)) {
    updateField(field.key, [...current, value]);
  }
  input.value = '';
}

function removeTag(field: FieldDescriptor, index: number): void {
  const current = (props.modelValue[field.key] as string[] | undefined) ?? [];
  updateField(field.key, current.filter((_, i) => i !== index));
}

/** 提交：先本地 schema.parse，全通过才 emit submit 给父组件 */
function onSubmit(): void {
  // [Phase4-D4/C5] 未 blur 草稿兜底归一：键入后直接点提交（未触发 blur）的场景
  const pendingDrafts = Object.entries(arrayDrafts.value).filter(([, d]) => d !== undefined);
  let submitting: Record<string, unknown> = props.modelValue;
  if (pendingDrafts.length > 0) {
    submitting = { ...props.modelValue };
    const cleared = { ...arrayDrafts.value };
    for (const [key, draft] of pendingDrafts) {
      const parts = normalizeArrayText(draft as string);
      submitting[key] = parts;
      lastEmitted[key] = parts;
      cleared[key] = undefined;
    }
    arrayDrafts.value = cleared;
  }
  // [Phase4-D4e/E1] JSON 未 blur 草稿兜底：解析失败 → 保留草稿 + 字段级报错阻断提交
  const jsonNormalized = normalizePendingJsonDrafts(submitting);
  submitting = jsonNormalized.value;
  const errors = validateBySchema(props.schema, submitting);
  for (const key of jsonNormalized.failedKeys) {
    errors[key] = errors[key] ?? 'JSON 数组解析失败';
  }
  // [B2/裁决 9] id 只读自动分配：新增态留空（服务端 max+1），本地校验跳过该字段
  if (descriptors.value.some((f) => f.readOnly)) {
    delete errors['id'];
  }
  localErrors.value = errors;
  if (Object.keys(errors).length > 0) {
    return;
  }
  emit('submit', submitting);
}

/** serverErrors 变化时清掉本地同字段错误（后端为权威） */
watch(
  () => props.serverErrors,
  () => {
    if (props.serverErrors && Object.keys(props.serverErrors).length > 0) {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(localErrors.value)) {
        if (props.serverErrors[k] === undefined) {
          next[k] = v;
        }
      }
      localErrors.value = next;
    }
  },
);

function errorFor(key: string, childKey?: string): string {
  if (childKey !== undefined) {
    return fieldErrors.value[`${key}.${childKey}`] ?? '';
  }
  return fieldErrors.value[key] ?? '';
}
</script>

<template>
  <el-form label-width="110px" @submit.prevent="onSubmit">
    <template v-for="field in descriptors" :key="field.key">
      <!-- 嵌套对象：子字段组 -->
      <template v-if="field.widget === 'group'">
        <el-divider content-position="left">{{ field.label }}</el-divider>
        <el-form-item
          v-for="child in field.children"
          :key="child.key"
          :error="errorFor(field.key, child.key) || undefined"
        >
          <template #label>
            <span class="field-label-text">{{ child.label }}</span>
            <FieldHint v-if="child.required" :description="child.description" :label="child.label" />
          </template>
          <el-input-number
            v-if="child.widget === 'number'"
            :model-value="((modelValue[field.key] as Record<string, unknown> | undefined)?.[child.key] as number) ?? 0"
            @update:model-value="(v: unknown) => updateNestedField(field.key, child.key, v)"
          />
          <el-input
            v-else
            :model-value="((modelValue[field.key] as Record<string, unknown> | undefined)?.[child.key] as string) ?? ''"
            @update:model-value="(v: unknown) => updateNestedField(field.key, child.key, v)"
          />
        </el-form-item>
      </template>

<!-- 顶层字段 -->
      <el-form-item
        v-else
        :required="field.required"
        :error="errorFor(field.key) || undefined"
      >
        <template #label>
          <span class="field-label-text">{{ field.label }}</span>
          <FieldHint v-if="field.required" :description="field.description" :label="field.label" />
        </template>
        <!-- [B2/裁决 9 + C2b] id 只读展示（编辑态显示现值、新增态留空提示）；
             [Phase4-D4/B3] string id 集合新增态可输入（idEditable，服务端 slugify 白名单为准） -->
        <el-input
          v-if="field.readOnly && !editableId"
          :model-value="modelValue[field.key] === undefined || modelValue[field.key] === null ? '' : String(modelValue[field.key])"
          disabled
          placeholder="留空自动生成"
        />
        <el-input
          v-else-if="field.readOnly && editableId"
          :model-value="modelValue[field.key] === undefined || modelValue[field.key] === null ? '' : String(modelValue[field.key])"
          placeholder="可留空自动生成；仅小写字母、数字与连字符（-）"
          @update:model-value="(v: unknown) => updateField(field.key, v)"
        />
        <!-- 字符串长文本 -->
        <el-input
          v-else-if="field.widget === 'textarea'"
          :model-value="(modelValue[field.key] as string) ?? ''"
          type="textarea"
          :rows="4"
          @update:model-value="(v: unknown) => updateField(field.key, v)"
        />
        <!-- [R2-9] 日期：el-date-picker（日精度 YYYY-MM-DD；[C2b] 月精度 YYYY-MM） -->
        <el-date-picker
          v-else-if="field.widget === 'date'"
          :model-value="(modelValue[field.key] as string) ?? undefined"
          :type="field.datePrecision === 'month' ? 'month' : 'date'"
          :value-format="field.datePrecision === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD'"
          placeholder="选择日期"
          :format="field.datePrecision === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD'"
          class="date-input"
          @update:model-value="(v: unknown) => updateDateField(field, v)"
        />
        <!-- 布尔 -->
        <el-switch
          v-else-if="field.widget === 'switch'"
          :model-value="(modelValue[field.key] as boolean) ?? false"
          @update:model-value="(v: unknown) => updateField(field.key, v)"
        />
        <!-- 数字 -->
        <el-input-number
          v-else-if="field.widget === 'number'"
          :model-value="(modelValue[field.key] as number) ?? 0"
          @update:model-value="(v: unknown) => updateField(field.key, v)"
        />
        <!-- 枚举 -->
        <el-select
          v-else-if="field.widget === 'select'"
          :model-value="(modelValue[field.key] as string) ?? ''"
          @update:model-value="(v: unknown) => updateField(field.key, v)"
          placeholder="请选择"
        >
          <el-option v-for="opt in field.options" :key="opt" :label="opt" :value="opt" />
        </el-select>
        <!-- [C2b→E1] 对象数组（timeline.links）：JSON 文本框兜底——input 透传草稿、blur 才解析（与 C5 同病同治） -->
        <el-input
          v-else-if="field.widget === 'json'"
          :model-value="jsonTextOf(field)"
          type="textarea"
          :rows="6"
          :placeholder="JSON_PLACEHOLDER"
          @update:model-value="(v: string) => onJsonInput(field, v)"
          @blur="onJsonBlur(field)"
        />
        <!-- [Phase4-D4/A5→C5] 字符串数组：input 透传原值（草稿态），blur 才归一数组化 -->
        <el-input
          v-else-if="field.widget === 'tags-text'"
          :model-value="arrayTextOf(field)"
          :placeholder="`多项用逗号/顿号分隔，如：甲、乙`"
          @update:model-value="(v: string) => onArrayInput(field, v)"
          @blur="onArrayBlur(field)"
        />
        <!-- 标签数组 -->
        <div v-else-if="field.widget === 'tags'" class="tags-input">
          <el-tag
            v-for="(tag, i) in (modelValue[field.key] as string[] | undefined) ?? []"
            :key="i"
            closable
            @close="removeTag(field, i)"
            class="tag-chip"
          >
            {{ tag }}
          </el-tag>
          <el-input
            :placeholder="`回车添加${field.label}`"
            @keydown.enter.prevent="onTagEnter($event, field)"
            class="tag-input"
          />
        </div>
        <!-- 普通文本 -->
        <el-input
          v-else
          :model-value="(modelValue[field.key] as string) ?? ''"
          :placeholder="field.placeholder"
          @update:model-value="(v: unknown) => updateField(field.key, v)"
        />
        <!-- [R2-12] 字段下方灰字帮助文案（description） -->
        <div v-if="field.description" class="field-help">{{ field.description }}</div>
      </el-form-item>
    </template>

    <el-form-item>
      <el-button type="primary" :loading="loading" @click="onSubmit">
        {{ submitLabel ?? '提交' }}
      </el-button>
      <el-button @click="emit('cancel')">取消</el-button>
    </el-form-item>
  </el-form>
</template>

<style scoped>
.field-label-text {
  vertical-align: middle;
}
.tags-input {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  width: 100%;
}
.tag-chip {
  margin: 0;
}
.tag-input {
  flex: 1;
  min-width: 160px;
}
.date-input {
  width: 100%;
}
/* [R2-12] 字段下方帮助文案（灰字说明） */
.field-help {
  width: 100%;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
</style>
