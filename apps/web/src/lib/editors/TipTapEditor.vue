<script setup lang="ts">
/**
 * [P10c] TipTap 富文本编辑器封装
 * [职责] 封装 @tiptap/vue-3 的 EditorContent，提供 v-model（JSON）双向绑定；
 *   工具栏支持标题(1-6)、有序/无序列表、引用、代码块、链接、图片、表格。
 *   禁止 v-html 渲染后端 HTML（§5 专属禁止）——编辑器仅在 TipTap 自身渲染。
 * [状态] ACTIVE
 *
 * 安全：editor.getJSON() → doc_json → 后端生成 html_cache；前端不执行后端 HTML。
 *
 * [Phase4-D4/A6] 图片展示层走 imageSrc（自定义 NodeView，模型 src 保真）：富文本路径
 *   曾是全前端唯一未接入 imageSrc 的图片出口（其余四处消费点见 image-src.ts），
 *   站内相对路径在管理端 origin 下解析 → 404 破图。改法与取舍见 SiteAssetsImage 注释。
 * [Phase5-E1/A6b] 位图粘贴/拖拽直传（A6 系列收尾）：editorProps 拦截图片文件 →
 *   POST /admin/media（五件套管线全复用，零旁路）→ 插入 toSiteReference 形态
 *   （/images/uploads/...）。上传中占位态防重复触发；失败 toast + 不插入。
 * [Phase5-E1/E0] 工具栏 Img 按钮：原 ElMessageBox.prompt URL 单轨（禁 fill 单轨
 *   铁律的既存违例）→ D2 已交付的 MediaPicker 弹窗（三通道，查重结论不重复建设）。
 */
import { computed, ref, watch } from 'vue';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { imageSrc } from '../image-src';
import { toSiteReference } from '../media-ref';
import { notifyApiError } from '../notify';
import { mediaApi } from '../../api/media';
import MediaPicker, { type MediaPickResult } from '../../components/MediaPicker.vue';
// TipTap v3：extension-table 无默认导出（命名导出），其余 table 子包有默认导出
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { ElMessageBox } from 'element-plus';

/**
 * [Phase4-D4 / A6 修复] 富文本编辑器内图片展示层拼源（模型零触碰）
 *
 * 根因：管理面板运行在管理服务端 origin 下，文章内的站内相对路径
 *   （如 images/uploads/x.png）会相对该 origin 解析 → 404 破图。富文本（TipTap）
 *   路径此前是全前端唯一未接入 imageSrc 的图片出口，故破图只出现在富文本、md 正常。
 *
 * 方案（架构师裁定 §3 首选）：自定义 NodeView —— 只改写渲染 DOM 的 src，
 *   ProseMirror 模型与 getJSON()/html_cache 一律保持原始 src。
 *   · 与 Vditor「预览层改写 + 反向还原」同语义，但**无需反向还原**：
 *     TipTap 模型为 JSON，DOM 由模型单向派生、不会回流进模型，
 *     故不存在 Vditor 那种 contenteditable 反向序列化导致的泄漏面。
 *   · 不采用 renderHTML 改写：renderHTML 是序列化出口，会污染 getHTML()
 *     与后端 html_cache，违反「模型 src 保真」。
 *   · 不触碰宿主（RichArticleEditPage）：无 contentSlug prop，富文本文章为 DB
 *     内容、无文件夹 slug 语义，contentPostSrc 不适用（裁定否决）。
 */
function richImageSrc(raw: string): string {
  if (raw === '') {
    return '';
  }
  // [B3.6 语义对齐] 已改写路径原样返回：imageSrc 对 /site-assets 前缀非幂等
  if (raw.trim().startsWith('/site-assets')) {
    return raw;
  }
  return imageSrc(raw);
}

/** 展示属性透传（src 单独走 richImageSrc 拼接，不在此列） */
const IMAGE_PASSTHROUGH_ATTRS = ['alt', 'title', 'width', 'height'] as const;

/**
 * 图片节点展示层：DOM 由 NodeView 自建，src 经 imageSrc 拼接，其余展示属性原样透传。
 * 每次由模型当前值重算（模型 src 不变 → 结果稳定，天然幂等，无需 DOM 标记）。
 */
const SiteAssetsImage = Image.extend({
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('img');
      let current = node;

      const sync = (): void => {
        const raw = typeof current.attrs['src'] === 'string' ? current.attrs['src'] : '';
        const next = richImageSrc(raw);
        if (next === '') {
          dom.removeAttribute('src');
        } else {
          dom.setAttribute('src', next);
        }
        for (const key of IMAGE_PASSTHROUGH_ATTRS) {
          const value = current.attrs[key];
          if (typeof value === 'number') {
            dom.setAttribute(key, String(value));
          } else if (typeof value === 'string' && value !== '') {
            dom.setAttribute(key, value);
          } else {
            dom.removeAttribute(key);
          }
        }
      };

      sync();

      return {
        dom,
        update(updated) {
          if (updated.type !== current.type) {
            return false;
          }
          current = updated;
          sync();
          return true;
        },
      };
    };
  },
});

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

// ── [Phase5-E1/A6b] 位图粘贴/拖拽直传 ──

/** 上传中占位态（防重复触发：进行中时新粘贴/拖入不受理；工具栏 Img 同步 loading） */
const imageUploading = ref(false);

/** DataTransfer 中的图片文件（剪贴板位图 / 拖入文件；非图片返回空 → 走默认行为） */
function imageFilesFrom(dataTransfer: DataTransfer | null): File[] {
  if (dataTransfer === null) {
    return [];
  }
  const files: File[] = [];
  for (const file of dataTransfer.files) {
    if (file.type.startsWith('image/')) {
      files.push(file);
    }
  }
  return files;
}

/** 逐文件直传（管线全复用 POST /admin/media）：成功 → 插入 /images/uploads URL；失败 → toast + 不插入 */
async function uploadAndInsertImages(files: File[]): Promise<void> {
  if (files.length === 0 || imageUploading.value) {
    return; // 占位态防重复触发
  }
  imageUploading.value = true;
  try {
    for (const file of files) {
      try {
        const media = await mediaApi.upload(file);
        const src = toSiteReference(media.path); // public/images/uploads/... → /images/uploads/...
        const alt = file.name.replace(/\.[^.]+$/, '');
        editor.value?.chain().focus().setImage({ src, alt }).run();
      } catch (err) {
        notifyApiError(err, `图片上传失败（${file.name}）`); // 失败 toast + 不插入
      }
    }
  } finally {
    imageUploading.value = false;
  }
}

// ── [Phase5-E1/E0] 媒体选择器（D2 MediaPicker 复用，查重不重复建设） ──

const pickerVisible = ref(false);

function onImagesPicked(results: MediaPickResult[]): void {
  const ed = editor.value;
  if (ed === null || ed === undefined || results.length === 0) {
    return;
  }
  const chain = ed.chain().focus();
  for (const result of results) {
    const alt = (result.name ?? '').replace(/\.[a-zA-Z0-9]+$/, '');
    chain.setImage({ src: result.url, alt });
  }
  chain.run();
}

const editor = useEditor({
  content: isTipTapDoc(props.modelValue) ? props.modelValue : '',
  editable: props.editable,
  editorProps: {
    // [Phase5-E1/A6b] 图片文件粘贴 → 直传（返回 true 阻止默认插入 base64/无动作）
    handlePaste: (_view, event) => {
      const files = imageFilesFrom(event.clipboardData);
      if (files.length === 0) {
        return false; // 文本/富文本粘贴走默认
      }
      event.preventDefault();
      void uploadAndInsertImages(files);
      return true;
    },
    // [Phase5-E1/A6b] 外部图片文件拖入 → 直传（moved=true 的内部节点移动走默认）
    handleDrop: (_view, event, _slice, moved) => {
      if (moved) {
        return false;
      }
      const files = imageFilesFrom(event.dataTransfer);
      if (files.length === 0) {
        return false;
      }
      event.preventDefault();
      void uploadAndInsertImages(files);
      return true;
    },
  },
  extensions: [
    StarterKit,
    Link.configure({ openOnClick: false }),
    SiteAssetsImage,
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

/**
 * [Phase5-E1/E0] 工具栏图片按钮：打开 MediaPicker 弹窗（D2 三通道：媒体库/相册/外链，
 * 含现场上传）——原 ElMessageBox.prompt URL 单轨已随查重结论拆除（交互面禁单轨铁律）。
 */
function openImagePicker(): void {
  pickerVisible.value = true;
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
        <!-- [Phase5-E1] Img → MediaPicker 弹窗（E0 查重：D2 组件复用）；上传中 loading 同步占位态 -->
        <el-button :loading="imageUploading" @click="openImagePicker">Img</el-button>
        <el-button @click="insertTable" :type="isActive('table') ? 'primary' : 'default'">Table</el-button>
      </el-button-group>
      <el-button-group size="small">
        <el-button @click="undo">Undo</el-button>
        <el-button @click="redo">Redo</el-button>
      </el-button-group>
      <!-- [Phase5-E1/A6b] 粘贴/拖拽直传占位指示（进行中显示，防重复触发） -->
      <span v-if="imageUploading" class="upload-hint">图片上传中…</span>
    </div>
    <EditorContent class="tiptap-content" :editor="editor" />
    <!-- [Phase5-E1/E0] 统一选图器（D2 MediaPicker 复用：媒体库/相册/外链 + 现场上传） -->
    <MediaPicker v-model="pickerVisible" @picked="onImagesPicked" />
  </div>
</template>

<style scoped>
/* [Phase2-B1.5 / R2-11] 全部颜色改挂主题变量：亮/暗随 Element 变量与
   theme.css 的终端配色自动切换，本文件零硬编码颜色。 */
.tiptap-editor {
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
}

.tiptap-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-fill-color-light);
}

/* [Phase5-E1/A6b] 粘贴/拖拽直传占位指示（灰字，随 Element 双主题） */
.upload-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  align-self: center;
}

/* 工具栏激活态由 el-button type=primary 提供（Element 双主题自动适配） */
.tiptap-content {
  min-height: 400px;
  padding: 12px;
}

.tiptap-content :deep(.ProseMirror) {
  min-height: 376px;
  outline: none;
  background: transparent;
  color: var(--el-text-color-primary);
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
  border: 1px solid var(--el-border-color);
  padding: 6px 10px;
}

/* 行内代码底色（暗色自动换 fill 阶） */
.tiptap-content :deep(.ProseMirror code) {
  background: var(--el-fill-color);
  border-radius: 3px;
  padding: 1px 4px;
}

/* 代码块走终端配色变量（与控制台同一语义源，明暗两态均成立） */
.tiptap-content :deep(.ProseMirror pre) {
  background: var(--mizuki-terminal-bg);
  color: var(--mizuki-terminal-fg);
  border-radius: 4px;
  padding: 12px;
  font-family: Consolas, Monaco, monospace;
  overflow-x: auto;
}

.tiptap-content :deep(.ProseMirror pre code) {
  background: transparent;
  padding: 0;
}

.tiptap-content :deep(.ProseMirror blockquote) {
  border-left: 3px solid var(--el-border-color);
  padding-left: 12px;
  color: var(--el-text-color-secondary);
  margin: 8px 0;
}

.tiptap-content :deep(.ProseMirror img) {
  max-width: 100%;
  height: auto;
}
</style>
