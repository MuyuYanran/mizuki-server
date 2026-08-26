<script setup lang="ts">
/**
 * [P10c] 富文本文章编辑页（TipTap）
 * [职责] 新建/编辑富文本文章：
 *   - TipTap 编辑器（标题/列表/引用/代码块/图片/链接/表格）；
 *   - 元数据表单（title、slug、status、pubDate、pinned、summary、cover、categoryId）；
 *   - 保存：editor.getJSON() → doc_json → POST/PATCH /admin/articles；
 *   - 导出：HTML（服务端 html_cache 或 editor.getHTML()）。
 *   - 禁止 v-html 渲染后端 HTML（§5 专属禁止）——编辑器仅在 TipTap 自身渲染。
 * [状态] ACTIVE
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { TipTapEditor } from '../../lib/editors';
import { articlesApi, extractArticleIssues, type ArticleAdminView } from '../../api/articles';
import { ApiError } from '../../api/http';

const route = useRoute();
const router = useRouter();

const isEdit = computed(() => typeof route.params['id'] === 'string' && route.params['id'] !== '');
const editingId = computed(() => (isEdit.value ? String(route.params['id']) : ''));

const loading = ref(false);
const saving = ref(false);
const exporting = ref(false);

/** TipTap JSON（编辑器内容） */
const docJson = ref<unknown>({ type: 'doc', content: [{ type: 'paragraph' }] });

/** 元数据表单 */
const meta = ref({
  title: '',
  slug: '',
  status: 'draft' as 'draft' | 'published',
  pubDate: '',
  pinned: false,
  summary: '',
  cover: '',
  categoryId: '',
});

/** 后端返回的 html_cache（只读展示用） */
const htmlCache = ref<string | null>(null);

/** 后端字段错误 */
const serverErrors = ref<Record<string, string>>({});

onMounted(async () => {
  if (isEdit.value) {
    await loadArticle();
  }
});

async function loadArticle(): Promise<void> {
  loading.value = true;
  try {
    const article = await articlesApi.read(editingId.value);
    meta.value.title = article.title;
    meta.value.slug = article.slug;
    meta.value.status = article.status;
    meta.value.pubDate = article.pubDate ?? '';
    meta.value.pinned = article.pinned;
    meta.value.summary = article.summary ?? '';
    meta.value.cover = article.cover ?? '';
    meta.value.categoryId = article.categoryId ?? '';
    if (article.docJson !== undefined && article.docJson !== null) {
      docJson.value = article.docJson;
    }
    htmlCache.value = article.htmlCache ?? null;
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '加载失败');
    router.push('/articles');
  } finally {
    loading.value = false;
  }
}

/** 保存 */
async function onSave(): Promise<void> {
  if (meta.value.title.trim() === '') {
    ElMessage.warning('标题为必填');
    return;
  }
  saving.value = true;
  serverErrors.value = {};
  const body = {
    title: meta.value.title,
    docJson: docJson.value,
    slug: meta.value.slug || undefined,
    status: meta.value.status,
    pubDate: meta.value.pubDate || undefined,
    pinned: meta.value.pinned,
    summary: meta.value.summary || undefined,
    cover: meta.value.cover || undefined,
    categoryId: meta.value.categoryId || undefined,
  };
  try {
    if (isEdit.value) {
      const result = await articlesApi.update(editingId.value, body);
      htmlCache.value = result.htmlCache ?? null;
      ElMessage.success('保存成功');
    } else {
      const result = await articlesApi.create(body);
      ElMessage.success('创建成功');
      router.replace(`/articles/${encodeURIComponent(result.id)}/edit`);
    }
  } catch (err) {
    if (err instanceof ApiError) {
      ElMessage.error(err.message);
      serverErrors.value = extractArticleIssues(err.detail);
    } else {
      ElMessage.error('保存失败');
    }
  } finally {
    saving.value = false;
  }
}

/** 导出 HTML（用服务端 html_cache，无则提示） */
async function onExportHtml(): Promise<void> {
  exporting.value = true;
  try {
    // 优先用服务端 html_cache；编辑态未保存时为 null → 提示先保存
    if (isEdit.value && htmlCache.value === null) {
      await onSave();
    }
    if (htmlCache.value !== null && htmlCache.value !== '') {
      downloadText('article.html', htmlCache.value, 'text/html');
      ElMessage.success('HTML 已导出');
    } else {
      ElMessage.warning('无可用 HTML（请先保存）');
    }
  } finally {
    exporting.value = false;
  }
}

/** 导出 Markdown（降级：复制 HTML + 说明，不引入重型转换器） */
function onExportMd(): void {
  const html = htmlCache.value ?? '';
  if (html === '') {
    ElMessage.warning('无可用 HTML（请先保存）');
    return;
  }
  // 降级：将 HTML 包入 Markdown 代码块作为最小可用导出
  const md = `<!-- HTML 导出（Markdown 转换暂不支持，此为降级输出） -->\n\n\`\`\`html\n${html}\n\`\`\`\n`;
  downloadText('article.md', md, 'text/markdown');
  ElMessage.success('Markdown 已导出（HTML 降级格式）');
}

/** 下载文本文件 */
function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function goBack(): void {
  router.push('/articles');
}
</script>

<template>
  <div class="rich-article-edit-page" v-loading="loading">
    <div class="page-header">
      <el-button @click="goBack">返回</el-button>
      <h2>{{ isEdit ? '编辑富文本文章' : '新建富文本文章' }}</h2>
      <div class="header-actions">
        <el-button size="small" @click="onExportHtml" :loading="exporting">导出 HTML</el-button>
        <el-button size="small" @click="onExportMd">导出 Markdown</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </div>
    </div>

    <div class="edit-layout">
      <!-- 编辑器 -->
      <div class="editor-area">
        <TipTapEditor :model-value="docJson" @update:model-value="docJson = $event" />
      </div>

      <!-- 元数据侧栏 -->
      <div class="meta-sidebar">
        <el-form label-width="80px" size="small">
          <el-form-item label="标题" required>
            <el-input v-model="meta.title" />
            <div v-if="serverErrors['title']" class="field-error">{{ serverErrors['title'] }}</div>
          </el-form-item>
          <el-form-item label="slug">
            <el-input v-model="meta.slug" placeholder="留空自动生成" />
          </el-form-item>
          <el-form-item label="状态">
            <el-select v-model="meta.status" style="width: 100%">
              <el-option label="草稿" value="draft" />
              <el-option label="已发布" value="published" />
            </el-select>
          </el-form-item>
          <el-form-item label="发布日期">
            <el-input v-model="meta.pubDate" placeholder="2026-01-01" />
          </el-form-item>
          <el-form-item label="置顶">
            <el-switch v-model="meta.pinned" />
          </el-form-item>
          <el-form-item label="摘要">
            <el-input v-model="meta.summary" type="textarea" :rows="3" />
          </el-form-item>
          <el-form-item label="封面">
            <el-input v-model="meta.cover" placeholder="文件名或路径" />
          </el-form-item>
          <el-form-item label="分类">
            <el-input v-model="meta.categoryId" />
          </el-form-item>
        </el-form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rich-article-edit-page {
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

.editor-area {
  flex: 1;
  min-width: 0;
}

.meta-sidebar {
  width: 300px;
  flex-shrink: 0;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 4px;
  padding: 12px;
}

.field-error {
  color: var(--el-color-danger, #f56c6c);
  font-size: 12px;
}
</style>
