<script setup lang="ts">
/**
 * [P10c] Markdown 文章列表（含草稿箱、回收站）
 * [职责] 三视图 tab：全部（GET /admin/posts）、草稿箱（status==='draft' 筛选）、
 *   回收站（localStorage 跟踪的已删文章，恢复经备份 restore + sync）。
 *   操作：新建、编辑、删除（二次确认）、置顶切换。
 * [状态] ACTIVE
 *
 * 回收站取舍（§3.1）：后端无「list deleted」端点，前端 localStorage 跟踪
 * 删除时的 backupIds；恢复 = 逐备份 restore → POST /admin/posts/sync。
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { postsApi, recycleStore, restorePost, type PostListItem, type RecycleEntry } from '../../api/posts';
import { ApiError } from '../../api/http';

type TabKind = 'all' | 'drafts' | 'recycle';

const router = useRouter();

const activeTab = ref<TabKind>('all');
const loading = ref(false);
const posts = ref<PostListItem[]>([]);
const recycle = ref<RecycleEntry[]>([]);

/** 全部文章 */
const allPosts = computed(() => posts.value);

/** 草稿箱（status === 'draft'） */
const draftPosts = computed(() => posts.value.filter((p) => p.status === 'draft'));

/** 当前 tab 的数据 */
const currentList = computed<PostListItem[]>(() => {
  if (activeTab.value === 'drafts') {
    return draftPosts.value;
  }
  return allPosts.value;
});

onMounted(load);

async function load(): Promise<void> {
  loading.value = true;
  try {
    if (activeTab.value !== 'recycle') {
      posts.value = await postsApi.list();
    }
    recycle.value = recycleStore.list();
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

/** 切换 tab 时按需加载 */
function onTabChange(tab: string | number): void {
  const kind = tab as TabKind;
  activeTab.value = kind;
  if (kind !== 'recycle' && posts.value.length === 0) {
    load();
  }
}

function goNew(): void {
  router.push('/posts/new');
}

function goEdit(slug: string): void {
  router.push(`/posts/${encodeURIComponent(slug)}/edit`);
}

/** [Phase4-D4/S4/B2b→C2] 文件形态删除限制提示（同构服务端规则③文案；置顶已随编辑解除放开） */
const FILE_FORM_HINT = '文件形态文章不支持经面板删除，请在文件系统删除源文件（同步后索引自动软删）';

/** 置顶切换 */
async function togglePinned(row: PostListItem): Promise<void> {
  // [Phase4-D4/C2] 原 B2b 置顶守卫已拆除（file-form 编辑解除，updatePost 可达）
  const current = row.frontmatter['pinned'] === true;
  const next = !current;
  try {
    await postsApi.update(row.slug, { frontmatter: { pinned: next } });
    row.frontmatter['pinned'] = next;
    ElMessage.success(next ? '已置顶' : '已取消置顶');
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败');
  }
}

/** 删除（二次确认 → 记入回收站） */
async function onDelete(row: PostListItem): Promise<void> {
  // [Phase4-D4/S4/B2b→C2] 删除守卫保留（服务端规则③ 400 同构；编辑解除不影响删除限制）
  if (row.source === 'file') {
    ElMessage.warning(FILE_FORM_HINT);
    return;
  }
  try {
    await ElMessageBox.confirm(`确认删除文章「${row.slug}」？（可从回收站恢复）`, '删除确认', {
      type: 'warning',
    });
  } catch {
    return; // 取消
  }
  try {
    const result = await postsApi.remove(row.slug);
    recycleStore.add({
      slug: row.slug,
      title: typeof row.frontmatter['title'] === 'string' ? row.frontmatter['title'] : row.slug,
      backupIds: result.backupIds,
      deletedAt: new Date().toISOString(),
    });
    posts.value = posts.value.filter((p) => p.slug !== row.slug);
    recycle.value = recycleStore.list();
    ElMessage.success('已删除（可从回收站恢复）');
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '删除失败');
  }
}

/** 从回收站恢复 */
async function onRestore(entry: RecycleEntry): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认恢复文章「${entry.slug}」？`, '恢复确认');
  } catch {
    return;
  }
  try {
    await restorePost(entry);
    recycle.value = recycleStore.list();
    await load();
    ElMessage.success('已恢复');
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '恢复失败');
  }
}

/** 从回收站彻底清除（仅清 localStorage 记录，不影响后端） */
function onPurge(entry: RecycleEntry): void {
  recycleStore.remove(entry.slug);
  recycle.value = recycleStore.list();
  ElMessage.success('已从回收站列表清除');
}

/** 取标题 */
function titleOf(row: PostListItem): string {
  return typeof row.frontmatter['title'] === 'string' ? row.frontmatter['title'] : row.slug;
}

/** 取置顶 */
function pinnedOf(row: PostListItem): boolean {
  return row.frontmatter['pinned'] === true;
}

/** [Phase4-D4/C4] 状态标签 i18n（published/draft 英文裸值 → 中文；未知值回退原文） */
const STATUS_LABELS: Record<string, string> = { published: '已发布', draft: '草稿' };
function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** 取日期 */
function dateOf(row: PostListItem): string {
  const d = row.frontmatter['pubDate'] ?? row.frontmatter['date'];
  if (typeof d === 'string') {
    return d;
  }
  if (d instanceof Date) {
    return d.toISOString().slice(0, 10);
  }
  return '';
}
</script>

<template>
  <div class="post-list-page panel-card">
    <div class="page-header">
      <h2>Markdown 文章</h2>
      <el-button type="primary" @click="goNew">新建文章</el-button>
    </div>

    <el-tabs :model-value="activeTab" @tab-change="onTabChange">
      <el-tab-pane label="全部" name="all" />
      <el-tab-pane label="草稿箱" name="drafts" />
      <el-tab-pane label="回收站" name="recycle" />
    </el-tabs>

    <!-- 全部 / 草稿箱 -->
    <el-table v-if="activeTab !== 'recycle'" v-loading="loading" :data="currentList" border>
      <el-table-column prop="slug" label="slug" width="180" />
      <el-table-column label="标题">
        <template #default="{ row }">{{ titleOf(row) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">{{ statusLabel(row.status) }}</template>
      </el-table-column>
      <el-table-column label="置顶" width="80">
        <template #default="{ row }">
          <el-tag v-if="pinnedOf(row)" type="warning" size="small">置顶</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="日期" width="120">
        <template #default="{ row }">{{ dateOf(row) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="300" fixed="right">
        <template #default="{ row }">
          <!-- [Phase4-D4/S4/B2b→C2] 文件形态（source==='file'）剩余限制：仅删除禁用
               + 「文件」标志（title 提示同构服务端规则③文案）；置顶/编辑随编辑解除放开 -->
          <el-tag v-if="row.source === 'file'" type="info" size="small" :title="FILE_FORM_HINT">文件</el-tag>
          <el-button size="small" @click="goEdit(row.slug)">编辑</el-button>
          <el-button size="small" @click="togglePinned(row)">
            {{ pinnedOf(row) ? '取消置顶' : '置顶' }}
          </el-button>
          <el-button
            size="small"
            type="danger"
            :disabled="row.source === 'file'"
            :title="row.source === 'file' ? FILE_FORM_HINT : undefined"
            @click="onDelete(row)"
          >删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 回收站 -->
    <div v-else>
      <el-alert type="info" :closable="false" show-icon style="margin-bottom: 12px">
        回收站仅记录本浏览器中删除的文章。恢复需后端备份链路可用（POST /admin/backups/:id/restore + sync）。
      </el-alert>
      <el-table :data="recycle" border v-if="recycle.length > 0">
        <el-table-column prop="slug" label="slug" width="180" />
        <el-table-column prop="title" label="标题" />
        <el-table-column prop="deletedAt" label="删除时间" width="180" />
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click="onRestore(row)">恢复</el-button>
            <el-button size="small" @click="onPurge(row)">清除记录</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else description="回收站为空" />
    </div>
  </div>
</template>

<style scoped>
.post-list-page {
  /* [Phase4-D3] padding 由 .panel-card 统一提供 */
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.page-header h2 {
  margin: 0;
}
</style>
