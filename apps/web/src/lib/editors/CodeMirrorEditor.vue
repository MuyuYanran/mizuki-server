<script setup lang="ts">
/**
 * [P10c] CodeMirror 6 Markdown 编辑器封装
 * [职责] 在 Vue 3 中封装 CodeMirror 6 的 EditorView，提供 v-model 双向绑定；
 *   支持 Markdown 语法高亮、行号、等宽字体。
 * [状态] ACTIVE
 *
 * 设计：单向数据流——父组件持有 modelValue，子组件只在用户输入时 emit 更新；
 *   父组件外部设置 modelValue 时（如读单篇后），经 dispatch 重建 state。
 */
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
// CodeMirror 6 子包直接依赖（pnpm 严格布局：`codemirror` 元包只导出
// basicSetup/minimalSetup，EditorState/keymap 等基础构件须从子包导入，
// 子包版本与 lockfile 既有解析一致）
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';

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

function buildExtensions(): Extension[] {
  const exts: Extension[] = [
    history(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    markdown(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
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
</script>

<template>
  <div ref="containerRef" class="cm-editor-wrap"></div>
</template>

<style scoped>
.cm-editor-wrap {
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 4px;
  overflow: hidden;
}

.cm-editor-wrap :deep(.cm-editor) {
  background: #fff;
}

.cm-editor-wrap :deep(.cm-editor.cm-focused) {
  outline: 2px solid var(--el-color-primary, #409eff);
}

.cm-editor-wrap :deep(.cm-gutters) {
  border-right: 1px solid var(--el-border-color, #dcdfe6);
  background: #fafafa;
}
</style>
