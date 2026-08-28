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
import { describeSchema, validateBySchema, type FieldDescriptor } from './mapper';
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
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: Record<string, unknown>): void;
  (e: 'submit', value: Record<string, unknown>): void;
  (e: 'cancel'): void;
}>();

const descriptors = computed<FieldDescriptor[]>(() => describeSchema(props.schema));

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
  const errors = validateBySchema(props.schema, props.modelValue);
  // [B2/裁决 9] id 只读自动分配：新增态留空（服务端 max+1），本地校验跳过该字段
  if (descriptors.value.some((f) => f.readOnly)) {
    delete errors['id'];
  }
  localErrors.value = errors;
  if (Object.keys(errors).length > 0) {
    return;
  }
  emit('submit', props.modelValue);
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
        <!-- [B2/裁决 9] id 自动分配：只读展示（编辑态显示现值、新增态留空提示） -->
        <el-input
          v-if="field.readOnly"
          :model-value="modelValue[field.key] === undefined || modelValue[field.key] === null ? '' : String(modelValue[field.key])"
          disabled
          placeholder="自动分配"
        />
        <!-- 字符串长文本 -->
        <el-input
          v-else-if="field.widget === 'textarea'"
          :model-value="(modelValue[field.key] as string) ?? ''"
          type="textarea"
          :rows="4"
          @update:model-value="(v: unknown) => updateField(field.key, v)"
        />
        <!-- [R2-9] 日期：el-date-picker（YYYY-MM-DD） -->
        <el-date-picker
          v-else-if="field.widget === 'date'"
          :model-value="(modelValue[field.key] as string) ?? undefined"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="选择日期"
          format="YYYY-MM-DD"
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
