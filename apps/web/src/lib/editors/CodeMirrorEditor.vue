<script setup lang="ts">
/**
 * [P10c] CodeMirror 6 Markdown 编辑器封装
 * [职责] 在 Vue 3 中封装 CodeMirror 6 的 EditorView，提供 v-model 双向绑定；
 *   支持 Markdown 语法高亮、行号、等宽字体。
 * [Phase2-B1.5 / R2-11] 完整暗色适配：
 *   - @codemirror/theme-one-dark 作为暗色主题扩展（含行号栏/选中态/光标/
 *     current-line 全套 chrome），经 themeCompartment 动态重配；
 *   - 信号源统一接入 lib/theme.ts 的 resolvedTheme 三态广播（全站一处），
 *     切换即时生效无须刷新；组件卸载即随 view.destroy 释放（无独立 observer，
 *     无需额外断开）；
 *   - 本文件样式表不再出现任何硬编码颜色：亮色走 Element 变量（html:not(.dark)
 *     前缀确定性生效），暗色完全由 oneDark 接管。
 * [状态] ACTIVE
 *
 * 设计：单向数据流——父组件持有 modelValue，子组件只在用户输入时 emit 更新；
 *   父组件外部设置 modelValue 时（如读单篇后），经 dispatch 重建 state。
 */
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
// CodeMirror 6 子包直接依赖（pnpm 严格布局：`codemirror` 元包只导出
// basicSetup/minimalSetup，EditorState/keymap 等基础构件须从子包导入）
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { resolvedTheme } from '../../lib/theme';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    readonly?: boolean;
    placeholder?: string;
  }>(),
  {
    readonly: false,
    placeholder: '',
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

/** 容器 ref（EditorView 挂载点） */
const containerRef = ref<HTMLDivElement | null>(null);
/** EditorView 实例（shallowRef 避免 Vue 深度代理） */
const viewRef = shallowRef<EditorView | null>(null);

/** 标记：是否正在从外部更新（避免输入回环） */
let applyingExternal = false;

/** 主题仓：亮色为空扩展（默认样式 + 下方变量化样式表），暗色为 oneDark 全量接管 */
const themeCompartment = new Compartment();

/** 当前解析态对应的主题扩展集合 */
function themeExtensionFor(dark: boolean): Extension[] {
  return dark ? [oneDark] : [];
}

function buildExtensions(): Extension[] {
  const exts: Extension[] = [
    history(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    markdown(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    themeCompartment.of(themeExtensionFor(resolvedTheme.value === 'dark')),
    EditorView.theme({
      '&': {
        fontSize: '14px',
        fontFamily: 'Consolas, Monaco, "Courier New", monospace',
      },
      '.cm-content': { minHeight: '400px' },
    }),
  ];
  if (props.readonly) {
    exts.push(EditorState.readOnly.of(true));
  }
  if (props.placeholder !== '') {
    exts.push(cmPlaceholder(props.placeholder));
  }
  return exts;
}

onMounted(() => {
  if (containerRef.value === null) {
    return;
  }
  const view = new EditorView({
    parent: containerRef.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        ...buildExtensions(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingExternal) {
            emit('update:modelValue', update.state.doc.toString());
          }
        }),
      ],
    }),
  });
  viewRef.value = view;
});

onBeforeUnmount(() => {
  viewRef.value?.destroy();
  viewRef.value = null;
});

// 主题三态广播 → Compartment 即时重配（无须刷新页面）
watch(resolvedTheme, (next) => {
  const view = viewRef.value;
  if (view === null) {
    return;
  }
  view.dispatch({
    effects: themeCompartment.reconfigure(themeExtensionFor(next === 'dark')),
  });
});

/** 外部 modelValue 变化时（如读单篇后），替换编辑器内容 */
watch(
  () => props.modelValue,
  (next) => {
    const view = viewRef.value;
    if (view === null) {
      return;
    }
    const current = view.state.doc.toString();
    if (next === current) {
      return;
    }
    applyingExternal = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
    });
    applyingExternal = false;
  },
);
/** 暴露 getValue，供引擎切换时读取 */
function getValue(): string {
  return viewRef.value?.state.doc.toString() ?? '';
}

/**
 * [Phase4-D2/T5 图片按钮回调接入面] 光标处插入文本（选区末尾 dispatch；
 * 插入经 updateListener 正常走 emit，modelValue 同步不变）。
 */
function insertAtCursor(text: string): void {
  const view = viewRef.value;
  if (view === null) {
    return;
  }
  const pos = view.state.selection.main.to;
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
  });
}

defineExpose({ getValue, insertAtCursor });
</script>

<template>
  <div ref="containerRef" class="cm-editor-wrap"></div>
</template>

<style scoped>
/* [R2-11] 零硬编码颜色：亮色面走 Element 变量（:not(.dark) 前缀确保不被
   oneDark 注入样式 unpredictable 覆盖），暗色由 oneDark 扩展全量接管。 */
.cm-editor-wrap {
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  overflow: hidden;
}

.cm-editor-wrap :deep(.cm-editor.cm-focused) {
  outline: 2px solid var(--el-color-primary);
}

/* 亮色行号栏 / current-line / placeholder（暗色交由 oneDark） */
html:not(.dark) .cm-editor-wrap :deep(.cm-gutters) {
  border-right: 1px solid var(--el-border-color);
  background: var(--el-fill-color-light);
}

html:not(.dark) .cm-editor-wrap :deep(.cm-activeLine) {
  background: var(--el-fill-color-lighter);
}

html:not(.dark) .cm-editor-wrap :deep(.cm-placeholder) {
  color: var(--el-text-color-placeholder);
}
</style>
