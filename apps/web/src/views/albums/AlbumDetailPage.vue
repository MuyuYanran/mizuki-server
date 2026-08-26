<script setup lang="ts">
/**
 * [P10d] 相册详情页面
 * [职责] 图片网格 + 上传（非 JPG 自动转 JPG，由后端处理，前端提示）+
 *   删除单图（二次确认）+ 编辑 info（对话框，info.json 全字段）。
 * [状态] ACTIVE
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { albumsApi, type AlbumView, type AlbumInfo } from '../../api/albums';
import { ApiError } from '../../api/http';
import ImageUploader from '../../components/ImageUploader.vue';

const route = useRoute();
const albumName = computed(() => decodeURIComponent(String(route.params['id'] ?? '')));

const album = ref<AlbumView | null>(null);
const loading = ref(false);

interface EditForm {
  title: string;
  description: string;
  date: string;
  location: string;
  layout: string;
  columns: string;
}

const editVisible = ref(false);
const saving = ref(false);
const editForm = ref<EditForm>({
  title: '',
  description: '',
  date: '',
  location: '',
  layout: '',
  columns: '',
});

async function fetchDetail(): Promise<void> {
  loading.value = true;
  try {
    const all = await albumsApi.list();
    album.value = all.find((a) => a.name === albumName.value) ?? null;
    if (album.value === null) {
      ElMessage.error('相册不存在');
    }
  } catch (e) {
    handleError(e, '加载相册详情失败');
  } finally {
    loading.value = false;
  }
}

function onUploaded(): void {
  void fetchDetail();
}

async function onDeleteImage(imageName: string): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除图片「${imageName}」？`, '删除确认', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await albumsApi.deleteImage(albumName.value, imageName);
    ElMessage.success('已删除');
    await fetchDetail();
  } catch (e) {
    handleError(e, '删除图片失败');
  }
}

function openEdit(): void {
  if (album.value === null) {
    return;
  }
  const info = album.value.info;
  editForm.value = {
    title: info.title,
    description: info.description ?? '',
    date: info.date ?? '',
    location: info.location ?? '',
    layout: info.layout ?? '',
    columns: info.columns !== undefined ? String(info.columns) : '',
  };
  editVisible.value = true;
}

async function onSaveEdit(): Promise<void> {
  if (editForm.value.title.trim() === '') {
    ElMessage.warning('请输入标题');
    return;
  }
  saving.value = true;
  try {
    const patch: Partial<AlbumInfo> = {
      title: editForm.value.title,
      description: editForm.value.description || undefined,
      date: editForm.value.date || undefined,
      location: editForm.value.location || undefined,
      layout: editForm.value.layout || undefined,
      columns: editForm.value.columns ? Number(editForm.value.columns) : undefined,
    };
    await albumsApi.update(albumName.value, patch);
    ElMessage.success('已保存');
    editVisible.value = false;
    await fetchDetail();
  } catch (e) {
    handleError(e, '保存失败');
  } finally {
    saving.value = false;
  }
}

function handleError(e: unknown, fallback: string): void {
  if (e instanceof ApiError) {
    ElMessage.error(e.message);
  } else {
    ElMessage.error(fallback);
  }
}

onMounted(() => {
  void fetchDetail();
});
</script>

<template>
  <el-card v-loading="loading">
    <template #header>
      <div class="card-header">
        <span>{{ album?.info.title ?? albumName }}</span>
        <div class="actions">
          <ImageUploader label="上传图片" @uploaded="onUploaded" />
          <el-button @click="openEdit">编辑信息</el-button>
        </div>
      </div>
    </template>
    <el-alert v-if="album !== null" type="info" :closable="false" class="hint">
      非 JPG 图片上传后由后端自动转换为 JPG。
    </el-alert>
    <el-row v-if="album !== null" :gutter="12">
      <el-col v-for="img in album.images" :key="img" :span="4">
        <el-card class="image-card">
          <div class="image-name">{{ img }}</div>
          <el-button size="small" type="danger" @click="onDeleteImage(img)">删除</el-button>
        </el-card>
      </el-col>
      <el-col v-if="album.images.length === 0" :span="24">
        <el-empty description="暂无图片" />
      </el-col>
    </el-row>

    <el-dialog v-model="editVisible" title="编辑相册信息" width="500px">
      <el-form label-width="80px">
        <el-form-item label="标题" required>
          <el-input v-model="editForm.title" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editForm.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="日期">
          <el-input v-model="editForm.date" />
        </el-form-item>
        <el-form-item label="位置">
          <el-input v-model="editForm.location" />
        </el-form-item>
        <el-form-item label="布局">
          <el-input v-model="editForm.layout" />
        </el-form-item>
        <el-form-item label="列数">
          <el-input v-model="editForm.columns" type="number" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSaveEdit">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.actions {
  display: flex;
  gap: 8px;
}
.hint {
  margin-bottom: 12px;
}
.image-card {
  text-align: center;
  margin-bottom: 12px;
}
.image-name {
  font-size: 12px;
  color: #606266;
  margin-bottom: 8px;
  word-break: break-all;
}
</style>
