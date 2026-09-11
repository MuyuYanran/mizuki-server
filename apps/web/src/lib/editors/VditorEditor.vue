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
import { contentPostSrc, imageSrc } from '../../lib/image-src';

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
    /** [B2/裁决 1] 文章 slug：非空时相对路径图片经 content-posts 出口改写预览 */
    contentSlug?: string;
  }>(),
  {
    placeholder: '',
    height: '400px',
    mode: 'wysiwyg',
    contentSlug: '',
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

/**
 * [Phase4-D1] Vditor after() 完成标记。vditor 初始化为异步：lute（markdown↔DOM
 * 转换的 wasm 模块）由 cdn 异步加载，就绪前调用实例的 getValue/setValue 会抛
 * TypeError: Cannot read properties of undefined (reading 'VditorDOM2Md')，
 * 且异常发生在组件 update flush 中会中断后续更新（编辑页 v-loading 遮罩滞留、
 * 整页不可交互——走查实证，DevTools 控制台栈：VditorEditor.vue modelValue watch
 * → vditor.js getValue → lute 未定义）。after() 仅在内部资源就绪后触发，
 * 故以其为就绪门。
 */
let vditorReady = false;
/** [Phase4-D1/缺陷二] 块工具条误显守卫的 style 观测器（见 setupBlockToolbarGuard） */
let blockToolbarObserver: MutationObserver | null = null;

/** Vditor 主题名映射（classic=亮，dark=暗） */
function vditorTheme(theme: 'light' | 'dark'): 'classic' | 'dark' {
  return theme === 'dark' ? 'dark' : 'classic';
}

/**
 * [B3.6] 内容层主题映射：Vditor 的 options.theme 只换 chrome（工具栏/面板）
 * 变量，.vditor-reset 内容层的排版样式由 content-theme（preview.theme.current）
 * 独立承载——不同步就会出现「暗色 chrome + 亮色内容字」。初始化与 setTheme
 * 均须带上内容主题；样式表来自自托管 /vditor/<版本>/dist/css/content-theme/。
 */
function vditorContentTheme(theme: 'light' | 'dark'): 'light' | 'dark' {
  return theme;
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

/**
 * [B3.6 修复] 改写后→原始路径反查表。
 * wysiwyg/ir 的 contenteditable DOM 会被 Vditor 反向序列化为 Markdown，
 * 预览层改写的 img.src 若留在 DOM 会随 input/getValue 泄漏进源文本
 * （破坏保存往返字节一致）。emit/getValue 前一律用本表反向还原。
 */
const srcReverse = new Map<string, string>();

/**
 * 重写容器内图片 src（预览层；幂等，不触碰 modelValue）
 * [B3.6 修复] 已改写的 img 打 dataset 标记，防止每次键入触发重扫时
 * 对 /site-assets 路径重复加前缀（imageSrc 对已改写路径非幂等）。
 */
function rewriteImagePreview(container: HTMLElement): void {
  const imgs = container.querySelectorAll('img[data-src], img[src]');
  imgs.forEach((img) => {
    if (img instanceof HTMLElement && img.dataset.mzRewritten === '1') return;
    const raw = img.getAttribute('src') || img.getAttribute('data-src');
    if (!raw || raw.startsWith('/site-assets')) return;
    // [B2/裁决 1] 有 slug 时的相对路径引用优先走 content-posts 出口
    // （解析后落在 slug 目录内才改写；逃逸/外链/站内绝对路径 → null 走原管线）
    const next = contentPostSrc(props.contentSlug, raw) ?? imageSrc(raw);
    if (next === raw) return;
    srcReverse.set(next, raw);
    if (img instanceof HTMLElement) img.dataset.mzRewritten = '1';
    if (img.hasAttribute('data-src')) {
      img.setAttribute('data-src', next);
    }
    img.setAttribute('src', next);
  });
}

/** [B3.6 修复] 反向还原泄漏进源文本的预览层路径（imageSrc 的逆操作） */
function restoreValue(value: string): string {
  let out = value;
  srcReverse.forEach((original, rewritten) => {
    if (out.includes(rewritten)) {
      out = out.split(rewritten).join(original);
    }
  });
  return out;
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

/**
 * [Phase4-D1/缺陷二] 块工具条误显守卫。
 * 现象（走查取证）：vditor wysiwyg 的块工具条（上移/下移/删除，`.vditor-panel--none`，
 * 删除键 aria-label「删除<Ctrl+Shift+X>」）在普通段落获得选区时也会被上游置为
 * `display:block` 且不再复位——面板常驻浮于正文（用户侧呈「自动出现的空白提示框，
 * 悬停才显内容」）。上游 hide 逻辑仅在有块上下文时收尾，普通文本路径漏藏。
 * 处置：观测该面板的 style 写入——变为可见但当前选区不在 `.vditor-wysiwyg__block`
 * （代码块/数学块的块容器类，与上游 hasClosestByClassName 判定同源）时回写隐藏。
 * 块编辑态下工具条功能（移块/删块）原样保留，非 CSS 一刀强藏。
 */
function setupBlockToolbarGuard(): void {
  const container = containerRef.value;
  if (container === null) return;
  const panel = container.querySelector<HTMLElement>('.vditor-panel--none');
  if (panel === null) return;
  blockToolbarObserver?.disconnect();
  blockToolbarObserver = new MutationObserver(() => {
    if (panel.style.display !== 'block') return;
    const anchor = document.getSelection()?.anchorNode;
    const el = anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
    if (el === null || el.closest('.vditor-wysiwyg__block') === null) {
      panel.style.display = 'none';
    }
  });
  blockToolbarObserver.observe(panel, { attributes: true, attributeFilter: ['style'] });
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
  blockToolbarObserver?.disconnect();
  blockToolbarObserver = null;
  vditorRef.value?.destroy?.();
  vditorRef.value = null;
  vditorReady = false;
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
    // [B3.6] 内容层主题与 chrome 同步（否则暗色下 .vditor-reset 仍是亮色排版）
    preview: { theme: { current: vditorContentTheme(resolvedTheme.value) } },
    cdn: VDITOR_CDN,
    lang: 'zh_CN',
    toolbar: TOOLBAR,
    input: (value: string) => {
      if (inputTimer !== null) {
        clearTimeout(inputTimer);
      }
      inputTimer = setTimeout(() => {
        // [B3.6 修复] 反向还原预览层泄漏路径，保证 emit 的源文本为原始路径
        emit('update:modelValue', restoreValue(value));
      }, 300);
    },
    after: () => {
      /**
       * [B3.6 修复] 初始化完成后重放最新 modelValue：Vditor 初始化为异步，
       * 父级内容若在 after 前到达，watch 里的 setValue 会因内部状态未就绪
       * 被吞（编辑页正文不渲染）。此处以 props 现值为准补同步。
       * [Phase4-D1] after 即就绪门开启点（lute 已加载），此后 watch/getValue 才
       * 允许触碰实例（就绪前调用会抛 VditorDOM2Md TypeError）。
       */
      vditorReady = true;
      if (vditorRef.value && restoreValue(vditorRef.value.getValue()) !== props.modelValue) {
        vditorRef.value.setValue(props.modelValue);
      }
      setupImagePreviewRewrite();
      setupBlockToolbarGuard();
    },
  });
  vditorRef.value = vditor;
}

// 主题三态广播 → Vditor 主题即时切换（复用 theme.ts 信号源）
// [B3.6] 第二参同步内容层主题（setTheme 单参只换 chrome）
watch(resolvedTheme, (next) => {
  vditorRef.value?.setTheme?.(vditorTheme(next), vditorContentTheme(next));
});

// 父级 modelValue 变化时同步（如读单篇后）
watch(
  () => props.modelValue,
  (next) => {
    // [Phase4-D1] 就绪门：lute 加载完成前实例 getValue/setValue 会抛错并中断
    // 组件 update（编辑页 v-loading 遮罩滞留、整页不可交互——侦查实证）——
    // 直接跳过，after() 的重放机制会补同步。
    // [Phase4-D1/侦查留档] 缺陷一「按空格光标跳至文章开头」复现协议 20/20 未复现
    // （IME 开/关双态各 10 次）， setValue 回环防御（回声抑制）按批次协议不启用，
    // 待架构师裁决；机制假说与取证见 SESSIONS Phase4-D1 报告 T1.1。
    if (!vditorReady || vditorRef.value === null) {
      return;
    }
    // [B3.6 修复] 比对前先还原预览层路径，避免仅因预览改写触发无谓 setValue
    if (restoreValue(vditorRef.value.getValue()) !== next) {
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
// [B3.6 修复] 返回前反向还原预览层泄漏路径
// [Phase4-D1] 未就绪时返回 props 现值（内部 getValue 依赖 lute，就绪前调用会抛错）
function getValue(): string {
  const vditor = vditorRef.value;
  if (!vditorReady || vditor === null) {
    return props.modelValue;
  }
  return restoreValue(vditor.getValue());
}

function setValue(value: string): void {
  vditorRef.value?.setValue(value);
}

/**
 * [Phase4-D2/T5 图片按钮回调接入面（ADR-022）] 光标处插入文本
 * （vditor.insertValue；就绪门与 watch 同源——lute 未就绪时实例方法不可用）。
 * 仅暴露调用入口，包装层核心逻辑（输入回环/主题/图片改写）冻结不动。
 */
function insertAtCursor(text: string): void {
  if (!vditorReady || vditorRef.value === null) {
    return;
  }
  vditorRef.value.insertValue(text);
}

defineExpose({ getValue, setValue, insertAtCursor });
</script>

<template>
  <div ref="containerRef" class="vditor-editor"></div>
</template>

<style scoped>
.vditor-editor {
  width: 100%;
  /* [Phase4-D1/缺陷三] 支持视口填充布局：父容器为弹性列时由外部 :deep 覆盖为
     flex:1；父容器高度 auto（如关于页）时百分比回退 auto，既有固定 height prop
     （inline 样式在 .vditor 上）不受影响。 */
  height: 100%;
}

/* 让 Vditor 容器跟随 Element 边框变量，避免硬编码 */
:deep(.vditor) {
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
}

:deep(.vditor.vditor--fullscreen) {
  z-index: 2000;
}

/* [B3.6] 内容区主题映射（色源统一为 theme.css 的 --mizuki-vditor-* 变量）：
   亮色值与 Vditor 官方默认一致（无观感漂移），暗色值修复深底深字不可见。
   覆盖三编辑模式（.vditor-ir/.vditor-wysiwyg 共用 .vditor-reset 排版层，
   .vditor-sv 已由 chrome 变量接管）与预览层（.vditor-preview 内同为
   .vditor-reset）；官方 content-theme 切换为主链路，本规则为兜底层。 */
:deep(.vditor-reset) {
  color: var(--mizuki-vditor-content-color);
}
:deep(.vditor-wysiwyg pre.vditor-reset),
:deep(.vditor-ir pre.vditor-reset) {
  background-color: var(--mizuki-vditor-content-bg);
}
:deep(.vditor-reset h1),
:deep(.vditor-reset h2) {
  border-bottom-color: var(--mizuki-vditor-border);
}
:deep(.vditor-reset hr) {
  background-color: var(--mizuki-vditor-border);
}
:deep(.vditor-reset blockquote) {
  color: var(--mizuki-vditor-muted);
  border-left-color: var(--mizuki-vditor-border);
}
:deep(.vditor-reset table tr) {
  background-color: var(--mizuki-vditor-tr-bg);
  border-top-color: var(--mizuki-vditor-border);
}
:deep(.vditor-reset table td),
:deep(.vditor-reset table th) {
  border-color: var(--mizuki-vditor-cell-border);
}
:deep(.vditor-reset table tbody tr:nth-child(2n)) {
  background-color: var(--mizuki-vditor-zebra-bg);
}
:deep(.vditor-reset code:not(.hljs):not(.highlight-chroma)) {
  background-color: var(--mizuki-vditor-inline-code-bg);
}
:deep(.vditor-reset pre > code) {
  background-color: var(--mizuki-vditor-block-bg);
  border: 1px solid var(--mizuki-vditor-block-border);
}
:deep(.vditor-reset kbd) {
  color: var(--mizuki-vditor-content-color);
  background-color: var(--mizuki-vditor-block-bg);
  border-color: var(--mizuki-vditor-kbd-border);
  box-shadow: inset 0 -1px 0 var(--mizuki-vditor-kbd-border);
}
</style>
