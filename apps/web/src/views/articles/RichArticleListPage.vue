<script setup lang="ts">
/**
 * [P10c] 富文本文章列表
 * [职责] GET /admin/articles 列表；新建/编辑/删除（软删）。
 *   富文本软删不可从前端恢复（后端无 list-deleted 端点），已知限制记报告。
 * [状态] ACTIVE
 */
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { articlesApi, type ArticleAdminView } from '../../api/articles';
import { ApiError } from '../../api/http';

const router = useRouter();
const loading = ref(false);
const list = ref<ArticleAdminView[]>([]);

onMounted(load);

async function load(): Promise<void> {
  loading.value = true;
  try {
    list.value = await articlesApi.list();
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

function goNew(): void {
  router.push('/articles/new');
}

function goEdit(id: string): void {
  router.push(`/articles/${encodeURIComponent(id)}/edit`);
}

async function onDelete(row: ArticleAdminView): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除「${row.title}」？（软删，不可从面板恢复）`, '删除确认', {
      type: 'warning',
    });
  } catch {
    return;
  }
  try {
    await articlesApi.remove(row.id);
    list.value = list.value.filter((a) => a.id !== row.id);
    ElMessage.success('已删除');
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '删除失败');
  }
}
</script>

<template>
  <div class="rich-article-list-page panel-card">
    <div class="page-header">
      <div class="header-title-wrap">
        <h2>富文本文章</h2>
        <span class="header-desc">可视化所见即所得文章列表</span>
      </div>
      <el-button type="primary" class="btn-gradient-primary" @click="goNew">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        新建文章
      </el-button>
    </div>

    <el-table v-loading="loading" :data="list" border>
      <el-table-column prop="title" label="标题" />
      <el-table-column prop="slug" label="slug" width="180" />
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column label="置顶" width="80">
        <template #default="{ row }">
          <el-tag v-if="row.pinned" type="warning" size="small">置顶</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="pubDate" label="发布日期" width="120" />
      <el-table-column prop="updatedAt" label="更新时间" width="180" />
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="goEdit(row.id)">编辑</el-button>
          <el-button size="small" type="danger" @click="onDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.header-title-wrap h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.header-desc {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
  display: inline-block;
}
</style>
