<script setup lang="ts">
/**
 * [P10c] Markdown 文章编辑页（CodeMirror 6 + frontmatter 表单 + 封面）
 * [职责] 新建/编辑 Markdown 文章：
 *   - CodeMirror 6 编辑正文（语法高亮）；
 *   - 侧栏 frontmatter 表单（§6.10 的 12 个已知字段）；
 *   - 未知 frontmatter 键原样保留（提交时以读取时的完整 frontmatter 为基础合并）；
 *   - 封面上传（POST /admin/posts/:slug/cover）；
 *   - 上传 Markdown 文件入口（读文本填入编辑器）。
 * [状态] ACTIVE
 *
 * 往返保真（§3.2）：未知 frontmatter 键不丢——编辑时 fullFm 持有读取的完整 frontmatter，
 *   表单只编辑 12 个已知字段，提交时 { ...fullFm, ...formFm } 合并（已知字段覆盖，未知键保留）。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { CodeMirrorEditor, VditorEditor } from '../../lib/editors';
import { todayString } from '../../lib/schema-form/mapper';
import { postsApi, type PostView } from '../../api/posts';
import { ApiError } from '../../api/http';

const route = useRoute();
const router = useRouter();

/** 是否编辑态（有 :slug 路由参数） */
const isEdit = computed(() => typeof route.params['slug'] === 'string' && route.params['slug'] !== '');
const editingSlug = computed(() => (isEdit.value ? String(route.params['slug']) : ''));

const loading = ref(false);
const saving = ref(false);

/** 正文 */
const content = ref('');
/** 读取时的完整 frontmatter（含未知键） */
const fullFm = ref<Record<string, unknown>>({});

/** 引擎偏好：vditor 默认，持久化 localStorage */
const ENGINE_KEY = 'mizuki.editor.engine';
type Engine = 'vditor' | 'codemirror';
const engine = ref<Engine>((localStorage.getItem(ENGINE_KEY) as Engine | null) ?? 'vditor');
const editorRef = ref<{ getValue: () => string } | null>(null);

function onEngineChange(next: Engine): void {
  // 切换前把当前引擎的最新值刷入 content，确保新引擎不丢字符
  if (editorRef.value) {
    content.value = editorRef.value.getValue();
  }
  engine.value = next;
  localStorage.setItem(ENGINE_KEY, next);
}

/** 表单编辑的 12 个已知字段 */
const fm = ref({
  title: '',
  published: true as boolean,
  description: '',
  tags: [] as string[],
  category: '',
  author: '',
  permalink: '',
  pinned: false,
  draft: false,
  image: '',
  /** [B3.6] 默认当天（与 B1 SchemaForm 一致）；编辑时 populateForm 覆盖 */
  date: todayString(),
  pubDate: todayString(),
});

/** 标签输入 */
const tagInput = ref('');

/** 后端字段错误 */
const serverErrors = ref<Record<string, string>>({});

/** 封面上传 */
const coverUploading = ref(false);

onMounted(async () => {
  if (isEdit.value) {
    await loadPost();
  }
});

async function loadPost(): Promise<void> {
  loading.value = true;
  try {
    const post = await postsApi.read(editingSlug.value);
    content.value = post.content;
    fullFm.value = { ...post.frontmatter };
    populateForm(post.frontmatter);
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '加载失败');
    router.push('/posts');
  } finally {
    loading.value = false;
  }
}

/** 从完整 frontmatter 填充表单 12 字段 */
function populateForm(fmData: Record<string, unknown>): void {
  fm.value.title = typeof fmData['title'] === 'string' ? fmData['title'] : '';
  fm.value.published = fmData['published'] !== false; // 缺省视为已发布
  fm.value.description = typeof fmData['description'] === 'string' ? fmData['description'] : '';
  fm.value.tags = Array.isArray(fmData['tags']) ? (fmData['tags'] as string[]) : [];
  fm.value.category = typeof fmData['category'] === 'string' ? fmData['category'] : '';
  fm.value.author = typeof fmData['author'] === 'string' ? fmData['author'] : '';
  fm.value.permalink = typeof fmData['permalink'] === 'string' ? fmData['permalink'] : '';
  fm.value.pinned = fmData['pinned'] === true;
  fm.value.draft = fmData['draft'] === true;
  fm.value.image = typeof fmData['image'] === 'string' ? fmData['image'] : '';
  fm.value.date = dateToString(fmData['date']);
  fm.value.pubDate = dateToString(fmData['pubDate']);
}

function dateToString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return '';
}

/** 构建提交用的 frontmatter（合并：未知键保留 + 已知字段覆盖） */
function buildFrontmatter(): Record<string, unknown> {
  return {
    ...fullFm.value,
    title: fm.value.title,
    published: fm.value.published,
    description: fm.value.description || undefined,
    tags: fm.value.tags.length > 0 ? fm.value.tags : undefined,
    category: fm.value.category || undefined,
    author: fm.value.author || undefined,
    permalink: fm.value.permalink || undefined,
    pinned: fm.value.pinned,
    draft: fm.value.draft,
    image: fm.value.image || undefined,
    date: fm.value.date || undefined,
    pubDate: fm.value.pubDate || undefined,
  };
}

/** 标签操作 */
function addTag(): void {
  const value = tagInput.value.trim();
  if (value !== '' && !fm.value.tags.includes(value)) {
    fm.value.tags.push(value);
  }
  tagInput.value = '';
}

/** [B3.6] 日期选择回调：el-date-picker 清空回调 null → 空串（保持 string 语义） */
function onDatePick(field: 'date' | 'pubDate', value: unknown): void {
  fm.value[field] = typeof value === 'string' ? value : '';
}

function removeTag(index: number): void {
  fm.value.tags.splice(index, 1);
}

/** 保存 */
async function onSave(): Promise<void> {
  if (fm.value.title.trim() === '') {
    ElMessage.warning('标题为必填');
    return;
  }
  saving.value = true;
  serverErrors.value = {};
  try {
    if (isEdit.value) {
      await postsApi.update(editingSlug.value, {
        frontmatter: buildFrontmatter(),
        content: content.value,
      });
      ElMessage.success('保存成功');
    } else {
      const result = await postsApi.create({
        slug: newSlug.value,
        frontmatter: buildFrontmatter(),
        content: content.value,
      });
      ElMessage.success('创建成功');
      router.replace(`/posts/${encodeURIComponent(result.slug)}/edit`);
    }
    // 重新读取以同步 fullFm（往返保真）
    if (isEdit.value || newSlug.value !== '') {
      const slug = isEdit.value ? editingSlug.value : newSlug.value;
      const post = await postsApi.read(slug);
      fullFm.value = { ...post.frontmatter };
      content.value = post.content;
      populateForm(post.frontmatter);
    }
  } catch (err) {
    handleError(err);
  } finally {
    saving.value = false;
  }
}

/** 新建时的 slug 输入 */
const newSlug = ref('');

/** 封面上传 */
async function onCoverUpload(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file === undefined) {
    return;
  }
  if (!isEdit.value) {
    ElMessage.warning('请先保存文章再上传封面');
    return;
  }
  coverUploading.value = true;
  try {
    await postsApi.uploadCover(editingSlug.value, file);
    ElMessage.success('封面上传成功（已转 JPG）');
    await loadPost();
  } catch (err) {
    handleError(err);
  } finally {
    coverUploading.value = false;
    input.value = ''; // 重置以便重复选同一文件
  }
}

/** 上传 Markdown 文件 → 填入编辑器 */
function onMdUpload(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file === undefined) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result;
    if (typeof text === 'string') {
      content.value = text;
      ElMessage.success('已填入编辑器');
    }
  };
  reader.readAsText(file);
  input.value = '';
}

/** 统一错误处理 */
function handleError(err: unknown): void {
  if (err instanceof ApiError) {
    ElMessage.error(err.message);
    const detail = err.detail as Record<string, unknown> | null;
    if (detail !== null && typeof detail === 'object' && Array.isArray(detail['issues'])) {
      for (const issue of detail['issues']) {
        if (typeof issue === 'object' && issue !== null) {
          const i = issue as Record<string, unknown>;
          const path = typeof i['path'] === 'string' ? i['path'] : '';
          const message = typeof i['message'] === 'string' ? i['message'] : '校验失败';
          if (path !== '') {
            serverErrors.value[path] = message;
          }
        }
      }
    }
  } else {
    ElMessage.error('操作失败');
  }
}

function goBack(): void {
  router.push('/posts');
}

/** 未知 frontmatter 键（非 12 个已知字段） */
const KNOWN_FM_KEYS = new Set([
  'title', 'published', 'description', 'tags', 'category', 'author',
  'permalink', 'pinned', 'draft', 'image', 'date', 'pubDate',
]);
const unknownKeys = computed<string[]>(() =>
  Object.keys(fullFm.value).filter((k) => !KNOWN_FM_KEYS.has(k)),
);

/** 格式化未知键的值用于展示 */
function formatValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}
</script>

<template>
  <div class="post-edit-page" v-loading="loading">
    <div class="page-header">
      <el-button @click="goBack">返回</el-button>
      <h2>{{ isEdit ? '编辑文章' : '新建文章' }}</h2>
      <div class="header-actions">
        <el-select v-model="engine" size="small" @change="onEngineChange" style="width: 100px">
          <el-option label="Vditor" value="vditor" />
          <el-option label="CodeMirror" value="codemirror" />
        </el-select>
        <label class="upload-btn">
          <span>上传 Markdown</span>
          <input type="file" accept=".md,.markdown,.txt" hidden @change="onMdUpload" />
        </label>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </div>
    </div>

    <div class="edit-layout">
      <!-- 正文 -->
      <div class="content-area">
        <div v-if="!isEdit" class="slug-input">
          <el-input v-model="newSlug" placeholder="slug（目录名）" />
        </div>
        <VditorEditor
          v-if="engine === 'vditor'"
          ref="editorRef"
          :model-value="content"
          @update:model-value="content = $event"
          placeholder="输入 Markdown 正文…"
          height="600px"
        />
        <CodeMirrorEditor
          v-else
          ref="editorRef"
          :model-value="content"
          @update:model-value="content = $event"
          placeholder="输入 Markdown 正文…"
        />
      </div>

      <!-- frontmatter 侧栏 -->
      <div class="fm-sidebar">
        <el-form label-width="80px" size="small">
          <el-form-item label="标题" required>
            <el-input v-model="fm.title" />
            <div v-if="serverErrors['title']" class="field-error">{{ serverErrors['title'] }}</div>
          </el-form-item>
          <el-form-item label="已发布">
            <el-switch v-model="fm.published" />
          </el-form-item>
          <el-form-item label="草稿">
            <el-switch v-model="fm.draft" />
          </el-form-item>
          <el-form-item label="置顶">
            <el-switch v-model="fm.pinned" />
          </el-form-item>
          <el-form-item label="描述">
            <el-input v-model="fm.description" type="textarea" :rows="3" />
          </el-form-item>
          <el-form-item label="标签">
            <div class="tag-input-group">
              <el-tag
                v-for="(tag, index) in fm.tags"
                :key="index"
                closable
                size="small"
                @close="removeTag(index)"
                style="margin-right: 4px"
              >{{ tag }}</el-tag>
              <el-input
                v-model="tagInput"
                size="small"
                style="width: 100px"
                placeholder="回车添加"
                @keydown.enter.prevent="addTag"
              />
            </div>
          </el-form-item>
          <el-form-item label="分类">
            <el-input v-model="fm.category" />
          </el-form-item>
          <el-form-item label="作者">
            <el-input v-model="fm.author" />
          </el-form-item>
          <el-form-item label="永久链接">
            <el-input v-model="fm.permalink" placeholder="/post/..." />
          </el-form-item>
          <el-form-item label="封面">
            <el-input v-model="fm.image" placeholder="cover.jpg 或路径" />
            <label v-if="isEdit" class="upload-btn" :class="{ disabled: coverUploading }">
              <span>{{ coverUploading ? '上传中...' : '上传封面图' }}</span>
              <input type="file" accept=".jpg,.jpeg,.png,.webp,.gif" hidden @change="onCoverUpload" :disabled="coverUploading" />
            </label>
          </el-form-item>
          <el-form-item label="日期">
            <!-- [B3.6] el-date-picker（YYYY-MM-DD）替代裸 el-input -->
            <el-date-picker
              :model-value="fm.date || undefined"
              type="date"
              value-format="YYYY-MM-DD"
              format="YYYY-MM-DD"
              placeholder="选择日期"
              class="date-input"
              @update:model-value="(v: unknown) => onDatePick('date', v)"
            />
          </el-form-item>
          <el-form-item label="发布日期">
            <el-date-picker
              :model-value="fm.pubDate || undefined"
              type="date"
              value-format="YYYY-MM-DD"
              format="YYYY-MM-DD"
              placeholder="选择日期"
              class="date-input"
              @update:model-value="(v: unknown) => onDatePick('pubDate', v)"
            />
          </el-form-item>
        </el-form>

        <!-- 未知 frontmatter 键提示 -->
        <div v-if="unknownKeys.length > 0" class="unknown-keys">
          <el-divider content-position="left">额外字段（原样保留）</el-divider>
          <div v-for="key in unknownKeys" :key="key" class="unknown-key">
            <span class="key">{{ key }}:</span>
            <span class="value">{{ formatValue(fullFm[key]) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.post-edit-page {
  padding: 16px;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.page-header h2 {
  margin: 0;
  flex: 1;
}

.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.edit-layout {
  display: flex;
  gap: 16px;
}

.content-area {
  flex: 1;
  min-width: 0;
}

.slug-input {
  margin-bottom: 8px;
}

.fm-sidebar {
  width: 320px;
  flex-shrink: 0;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  padding: 12px;
  max-height: 70vh;
  overflow-y: auto;
}

.tag-input-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.date-input {
  width: 100%;
}

.upload-btn {
  display: inline-block;
  cursor: pointer;
  color: var(--el-color-primary);
  font-size: 13px;
}

.upload-btn.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.field-error {
  color: var(--el-color-danger);
  font-size: 12px;
}

.unknown-keys {
  margin-top: 12px;
}

.unknown-key {
  font-size: 13px;
  margin-bottom: 4px;
}

.unknown-key .key {
  color: var(--el-text-color-secondary);
  margin-right: 6px;
}

.unknown-key .value {
  color: var(--el-text-color-secondary);
  word-break: break-all;
}
</style>
