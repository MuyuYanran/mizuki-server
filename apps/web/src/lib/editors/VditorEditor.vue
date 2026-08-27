<script setup lang="ts">
/**
 * [Phase2-B3 / R2-11] Vditor Markdown 编辑器封装（三模式：wysiwyg/ir/sv）
 * [职责]
 *   - Vue 3 中封装 Vditor，提供 v-model 双向绑定；
 *   - 三模式由父级 props.mode 传入；Vditor 初始化后无法切换模式，
 *     故 mode 变化时销毁重建（内容经 modelValue 保持）；
 *   - 暗色切换复用 lib/theme.ts 的 resolvedTheme 三态广播（与 CodeMirror
 *     同一信号源），禁止自行 MutationObserver/独立监听；
 *   - 站内图片（/images/...、public/images/...）在预览层经 imageSrc() 重写为
 *     /site-assets/...，存储文本不被改写（ADR-012）。
 * [状态] ACTIVE
 */
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue';
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import { resolvedTheme } from '../../lib/theme';
import { imageSrc } from '../../lib/image-src';

/**
 * [B3.5 自托管] Vditor 运行时资源（i18n/highlight/mermaid/katex 等）本地化。
 * 升级 vditor 版本时须同步：
 *   1. apps/web/public/vditor/<新版本>/ （从 node_modules/vditor/dist 全量拷贝）
 *   2. 下方 VDITOR_VERSION 常量
 *   3. docs/decisions/ADR-001-dependency-versions.md vditor 条目维护义务
 */
const VDITOR_VERSION = '3.11.3';
const VDITOR_CDN = `/vditor/${VDITOR_VERSION}`;

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    height?: string;
    mode?: 'wysiwyg' | 'ir' | 'sv';
  }>(),
  {
    placeholder: '',
    height: '400px',
    mode: 'wysiwyg',
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const containerRef = ref<HTMLDivElement | null>(null);
/** Vditor 实例 */
const vditorRef = shallowRef<Vditor | null>(null);

let inputTimer: ReturnType<typeof setTimeout> | null = null;
/** 图片预览重写 MutationObserver */
let imgObserver: MutationObserver | null = null;

/** Vditor 主题名映射（classic=亮，dark=暗） */
function vditorTheme(theme: 'light' | 'dark'): 'classic' | 'dark' {
  return theme === 'dark' ? 'dark' : 'classic';
}

/** 默认 toolbar（与 Vditor 内置默认一致，不含脑图/甘特/图表等） */
const TOOLBAR = [
  'emoji',
  'headings',
  'bold',
  'italic',
  'strike',
  'link',
  'list',
  'ordered-list',
  'check',
  'outdent',
  'indent',
  'quote',
  'line',
  'code',
  'inline-code',
  'insert-after',
  'insert-before',
  'upload',
  'record',
  'table',
];

/** 重写容器内图片 src（预览层，不触碰 modelValue） */
function rewriteImagePreview(container: HTMLElement): void {
  const imgs = container.querySelectorAll('img[data-src], img[src]');
  imgs.forEach((img) => {
    const raw = img.getAttribute('src') || img.getAttribute('data-src');
    if (!raw) return;
    const next = imageSrc(raw);
    if (next === raw) return;
    if (img.hasAttribute('data-src')) {
      img.setAttribute('data-src', next);
    }
    img.setAttribute('src', next);
  });
}

/** 建立图片预览 MutationObserver（只观测预览 DOM，不监听主题） */
function setupImagePreviewRewrite(): void {
  const container = containerRef.value;
  if (container === null) return;
  nextTick(() => {
    rewriteImagePreview(container);
  });
  imgObserver = new MutationObserver(() => {
    rewriteImagePreview(container);
  });
  imgObserver.observe(container, { childList: true, subtree: true });
}

onMounted(() => {
  initVditor();
});

onBeforeUnmount(() => {
  destroyVditor();
});

function destroyVditor(): void {
  if (inputTimer !== null) {
    clearTimeout(inputTimer);
    inputTimer = null;
  }
  imgObserver?.disconnect();
  imgObserver = null;
  vditorRef.value?.destroy?.();
  vditorRef.value = null;
}

function initVditor(): void {
  if (containerRef.value === null) {
    return;
  }
  destroyVditor();
  const theme = vditorTheme(resolvedTheme.value);
  const vditor = new Vditor(containerRef.value, {
    value: props.modelValue,
    mode: props.mode,
    placeholder: props.placeholder,
    height: props.height,
    cache: { enable: false },
    counter: { enable: true, type: 'text' as const },
    theme,
    cdn: VDITOR_CDN,
    lang: 'zh_CN',
    toolbar: TOOLBAR,
    input: (value: string) => {
      if (inputTimer !== null) {
        clearTimeout(inputTimer);
      }
      inputTimer = setTimeout(() => {
        emit('update:modelValue', value);
      }, 300);
    },
    after: () => {
      setupImagePreviewRewrite();
    },
  });
  vditorRef.value = vditor;
}

// 主题三态广播 → Vditor 主题即时切换（复用 theme.ts 信号源）
watch(resolvedTheme, (next) => {
  const t = vditorTheme(next);
  vditorRef.value?.setTheme?.(t);
});

// 父级 modelValue 变化时同步（如读单篇后）
watch(
  () => props.modelValue,
  (next) => {
    if (vditorRef.value && vditorRef.value.getValue() !== next) {
      vditorRef.value.setValue(next);
    }
  },
);

// 父级 mode 变化时重建 Vditor（Vditor 初始化后无法切换模式）
watch(
  () => props.mode,
  () => {
    initVditor();
  },
);

// 暴露 getValue，供引擎切换时父组件读取最新值
function getValue(): string {
  return vditorRef.value?.getValue() ?? '';
}

function setValue(value: string): void {
  vditorRef.value?.setValue(value);
}

defineExpose({ getValue, setValue });
</script>

<template>
  <div ref="containerRef" class="vditor-editor"></div>
</template>

<style scoped>
.vditor-editor {
  width: 100%;
}

/* 让 Vditor 容器跟随 Element 边框变量，避免硬编码 */
:deep(.vditor) {
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
}

:deep(.vditor.vditor--fullscreen) {
  z-index: 2000;
}
</style>
