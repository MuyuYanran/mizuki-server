<script setup lang="ts">
/**
 * [Phase2-B1 / R2-13] 必填项问号提示（el-tooltip 封装）
 * [职责] 必填字段标签旁渲染问号图标，悬停显示解释、移开消失；
 *   解释文案优先取 schema description（`.describe()`），未配置则显示
 *   通用必填提示（R2-13 逐字）。
 * [状态] ACTIVE
 */
import { computed } from 'vue';

const props = defineProps<{
  /** 解释文案（schema description）；缺省回落通用必填提示 */
  description?: string;
  /** 字段名（通用提示里引用，增强可读性） */
  label?: string;
}>();

/** 通用必填提示（未配 description 时，R2-13 允许的回落） */
const fallback = computed(
  () => `「${props.label ?? '此项'}」为必填字段，提交前需要填写。`,
);

const content = computed(() => props.description ?? fallback.value);
</script>

<template>
  <el-tooltip :content="content" placement="top" :show-after="200">
    <span class="field-hint" tabindex="0" role="note" :aria-label="content">
      <!-- 问号图标（内联 SVG，零图标依赖） -->
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9.5" />
        <path d="M9.2 9.2a2.8 2.8 0 1 1 4.1 2.5c-.8.5-1.3 1-1.3 1.9" />
        <circle cx="12" cy="17" r="0.5" fill="currentColor" />
      </svg>
    </span>
  </el-tooltip>
</template>

<style scoped>
.field-hint {
  display: inline-flex;
  align-items: center;
  margin-left: 4px;
  color: var(--el-text-color-secondary);
  cursor: help;
  vertical-align: middle;
}
.field-hint:hover {
  color: var(--el-color-primary);
}
</style>
