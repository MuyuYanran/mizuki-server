<script setup lang="ts">
/**
 * [P10d] 媒体库页面
 * [职责] 网格/表格展示 GET /admin/media（原名/尺寸/大小/路径）；上传
 *   （ImageUploader → 刷新列表）；删除（二次确认，409 展示引用明细
 *   ReferenceDetailDialog）；链接复制（media.path 到剪贴板，供内容页图片字段粘贴）。
 * [状态] ACTIVE
 *
 * 缩略图：后端未暴露 Mizuki public/ 的静态文件服务，本阶段不显示缩略图，
 *   展示文件信息 + 路径（记报告；P11 或二期补静态服务后可加缩略图）。
 */
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { mediaApi, extractMediaReferences, type MediaInfo, type MediaReference } from '../../api/media';
import { ApiError } from '../../api/http';
import ImageUploader from '../../components/ImageUploader.vue';
import ReferenceDetailDialog from '../../components/ReferenceDetailDialog.vue';

const list = ref<MediaInfo[]>([]);
const loading = ref(false);
const refDialogVisible = ref(false);
const refList = ref<MediaReference[]>([]);

async function fetchList(): Promise<void> {
  loading.value = true;
  try {
    list.value = await mediaApi.list();
  } catch (e) {
    handleError(e, '加载媒体列表失败');
  } finally {
    loading.value = false;
  }
}

function onUploaded(): void {
  void fetchList();
}

async function onDelete(media: MediaInfo): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除媒体「${media.originalName}」？`, '删除确认', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await mediaApi.remove(media.id);
    ElMessage.success('已删除');
    await fetchList();
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      refList.value = extractMediaReferences(e.detail);
      refDialogVisible.value = true;
    } else {
      handleError(e, '删除失败');
    }
  }
}

async function copyPath(media: MediaInfo): Promise<void> {
  try {
    await navigator.clipboard.writeText(media.path);
    ElMessage.success('路径已复制');
  } catch {
    ElMessage.warning(`复制失败，请手动复制：${media.path}`);
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN');
}

function handleError(e: unknown, fallback: string): void {
  if (e instanceof ApiError) {
    ElMessage.error(e.message);
  } else {
    ElMessage.error(fallback);
  }
}

onMounted(() => {
  void fetchList();
});
</script>

<template>
  <el-card v-loading="loading">
    <template #header>
      <div class="card-header">
        <span>媒体库</span>
        <ImageUploader multiple label="上传图片" @uploaded="onUploaded" />
      </div>
    </template>
    <el-table :data="list" border>
      <el-table-column label="原名" prop="originalName" />
      <el-table-column label="尺寸" width="120">
        <template #default="{ row }">
          {{ row.width != null && row.height != null ? `${row.width}×${row.height}` : '—' }}
        </template>
      </el-table-column>
      <el-table-column label="大小" width="100">
        <template #default="{ row }">{{ formatSize(row.size) }}</template>
      </el-table-column>
      <el-table-column label="路径" prop="path" />
      <el-table-column label="上传时间" width="190">
        <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="copyPath(row)">复制路径</el-button>
          <el-button size="small" type="danger" @click="onDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <ReferenceDetailDialog v-model="refDialogVisible" :references="refList" />
  </el-card>
</template>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>
