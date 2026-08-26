<script setup lang="ts">
/**
 * [P10c] TipTap 富文本编辑器封装
 * [职责] 封装 @tiptap/vue-3 的 EditorContent，提供 v-model（JSON）双向绑定；
 *   工具栏支持标题(1-6)、有序/无序列表、引用、代码块、链接、图片、表格。
 *   禁止 v-html 渲染后端 HTML（§5 专属禁止）——编辑器仅在 TipTap 自身渲染。
 * [状态] ACTIVE
 *
 * 安全：editor.getJSON() → doc_json → 后端生成 html_cache；前端不执行后端 HTML。
 */
import { computed, watch } from 'vue';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
// TipTap v3：extension-table 无默认导出（命名导出），其余 table 子包有默认导出
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { ElMessage, ElMessageBox } from 'element-plus';

const props = withDefaults(
  defineProps<{
    modelValue: unknown;
    editable?: boolean;
  }>(),
  {
    editable: true,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: unknown): void;
}>();

const editor = useEditor({
  content: isTipTapDoc(props.modelValue) ? props.modelValue : '',
  editable: props.editable,
  extensions: [
    StarterKit,
    Link.configure({ openOnClick: false }),
    Image,
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
  ],
  onUpdate: ({ editor }) => {
    emit('update:modelValue', editor.getJSON());
  },
});

/** 外部 modelValue 变化时同步到编辑器（如读单篇后） */
watch(
  () => props.modelValue,
  (next) => {
    const ed = editor.value;
    if (ed === null || ed === undefined) {
      return;
    }
    if (isTipTapDoc(next) && JSON.stringify(ed.getJSON()) !== JSON.stringify(next)) {
      ed.commands.setContent(next, { emitUpdate: false });
    }
  },
);

watch(
  () => props.editable,
  (next) => {
    editor.value?.setEditable(next);
  },
);

/** TipTap JSON 最小判断：对象且有 type 字段 */
function isTipTapDoc(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && 'type' in value;
}

// ── 工具栏命令 ──

const isActive = computed(() => {
  const ed = editor.value;
  if (ed === null || ed === undefined) {
    return () => false;
  }
  return (name: string, attrs?: Record<string, unknown>): boolean => ed.isActive(name, attrs);
});

function setHeading(level: number): void {
  editor.value?.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
}

function toggleBold(): void {
  editor.value?.chain().focus().toggleBold().run();
}

function toggleItalic(): void {
  editor.value?.chain().focus().toggleItalic().run();
}

function toggleStrike(): void {
  editor.value?.chain().focus().toggleStrike().run();
}

function toggleBulletList(): void {
  editor.value?.chain().focus().toggleBulletList().run();
}

function toggleOrderedList(): void {
  editor.value?.chain().focus().toggleOrderedList().run();
}

function toggleBlockquote(): void {
  editor.value?.chain().focus().toggleBlockquote().run();
}

function toggleCodeBlock(): void {
  editor.value?.chain().focus().toggleCodeBlock().run();
}

async function addLink(): Promise<void> {
  const ed = editor.value;
  if (ed === null || ed === undefined) {
    return;
  }
  const prevAttrs = ed.getAttributes('link') as Record<string, unknown> | undefined;
  const prevUrl = typeof prevAttrs?.['href'] === 'string' ? prevAttrs['href'] : '';
  const result = await ElMessageBox.prompt('输入链接地址', '插入链接', {
    inputValue: prevUrl,
    inputPlaceholder: 'https://...',
  });
  const url = result.value.trim();
  if (url === '') {
    ed.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  ed.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
}

async function addImage(): Promise<void> {
  const ed = editor.value;
  if (ed === null || ed === undefined) {
    return;
  }
  const result = await ElMessageBox.prompt('输入图片地址', '插入图片', {
    inputPlaceholder: 'https://... 或 /uploads/xxx.jpg',
  });
  const src = result.value.trim();
  if (src !== '') {
    ed.chain().focus().setImage({ src }).run();
  }
}

function insertTable(): void {
  editor.value?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
}

function undo(): void {
  editor.value?.chain().focus().undo().run();
}

function redo(): void {
  editor.value?.chain().focus().redo().run();
}
</script>

<template>
  <div class="tiptap-editor" v-if="editor">
    <div class="tiptap-toolbar">
      <el-button-group size="small">
        <el-button @click="setHeading(1)" :type="isActive('heading', { level: 1 }) ? 'primary' : 'default'">H1</el-button>
        <el-button @click="setHeading(2)" :type="isActive('heading', { level: 2 }) ? 'primary' : 'default'">H2</el-button>
        <el-button @click="setHeading(3)" :type="isActive('heading', { level: 3 }) ? 'primary' : 'default'">H3</el-button>
      </el-button-group>
      <el-button-group size="small">
        <el-button @click="toggleBold" :type="isActive('bold') ? 'primary' : 'default'">B</el-button>
        <el-button @click="toggleItalic" :type="isActive('italic') ? 'primary' : 'default'">I</el-button>
        <el-button @click="toggleStrike" :type="isActive('strike') ? 'primary' : 'default'">S</el-button>
      </el-button-group>
      <el-button-group size="small">
        <el-button @click="toggleBulletList" :type="isActive('bulletList') ? 'primary' : 'default'">UL</el-button>
        <el-button @click="toggleOrderedList" :type="isActive('orderedList') ? 'primary' : 'default'">OL</el-button>
        <el-button @click="toggleBlockquote" :type="isActive('blockquote') ? 'primary' : 'default'">Q</el-button>
        <el-button @click="toggleCodeBlock" :type="isActive('codeBlock') ? 'primary' : 'default'">Code</el-button>
      </el-button-group>
      <el-button-group size="small">
        <el-button @click="addLink">Link</el-button>
        <el-button @click="addImage">Img</el-button>
        <el-button @click="insertTable" :type="isActive('table') ? 'primary' : 'default'">Table</el-button>
      </el-button-group>
      <el-button-group size="small">
        <el-button @click="undo">Undo</el-button>
        <el-button @click="redo">Redo</el-button>
      </el-button-group>
    </div>
    <EditorContent class="tiptap-content" :editor="editor" />
  </div>
</template>

<style scoped>
.tiptap-editor {
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 4px;
}

.tiptap-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid var(--el-border-color, #dcdfe6);
  background: #fafafa;
}

.tiptap-content {
  min-height: 400px;
  padding: 12px;
}

.tiptap-content :deep(.ProseMirror) {
  min-height: 376px;
  outline: none;
}

.tiptap-content :deep(.ProseMirror:focus) {
  outline: none;
}

.tiptap-content :deep(.ProseMirror table) {
  border-collapse: collapse;
  width: 100%;
}

.tiptap-content :deep(.ProseMirror th),
.tiptap-content :deep(.ProseMirror td) {
  border: 1px solid #ddd;
  padding: 6px 10px;
}

.tiptap-content :deep(.ProseMirror pre) {
  background: #1e1e1e;
  color: #d4d4d4;
  border-radius: 4px;
  padding: 12px;
  font-family: Consolas, Monaco, monospace;
  overflow-x: auto;
}

.tiptap-content :deep(.ProseMirror blockquote) {
  border-left: 3px solid #ddd;
  padding-left: 12px;
  color: #666;
  margin: 8px 0;
}

.tiptap-content :deep(.ProseMirror img) {
  max-width: 100%;
  height: auto;
}
</style>
