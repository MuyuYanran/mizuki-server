<script setup lang="ts">
/**
 * [P10d] 相册详情页面
 * [职责] 图片网格 + 上传（非 JPG 自动转 JPG，由后端处理，前端提示）+
 *   删除单图（二次确认）+ 编辑 info（对话框，info.json 全字段）。
 * [状态] ACTIVE
 *
 * [Phase2-B1 / R2-8] 灯箱预览：v-viewer（viewerjs 封装）——网格点图打开
 *   灯箱，支持大图/缩放/旋转/左右切换/Esc 关闭；images 数组同源 URL 列表；
 * [Phase2-B1.5 / ADR-012] 本地图片 src 统一走 imageSrc() → /site-assets/
 *   通道（JWT 保护，后端托管 Mizuki public/），dev 由 vite 代理、生产同源。
 *   外部 URL 项不经通道（imageSrc 原样返回）——B2 R2-14 落地时无需改动本页。
 * [Phase2-B1] 前端分页：每页 60 张（R2-14 前端实现）。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api as viewerApi } from 'v-viewer';
import 'viewerjs/dist/viewer.css';
import { albumsApi, type AlbumView, type AlbumInfo } from '../../api/albums';
import { ApiError } from '../../api/http';
import { imageSrc } from '../../lib/image-src';

const route = useRoute();
const albumName = computed(() => decodeURIComponent(String(route.params['id'] ?? '')));

const album = ref<AlbumView | null>(null);
const loading = ref(false);

/** [B3.6] 相册图片上传（走相册专属端点，不经媒体库） */
const uploading = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);

/** 每页张数（R2-14 前端分页：60/页） */
const PAGE_SIZE = 60;
const currentPage = ref(1);

/** 缩略图加载失败标记（文件名 → true；显示占位而非破图） */
const failedThumbs = ref<Record<string, boolean>>({});

/** 当前页图片（分页窗口） */
const pagedImages = computed<string[]>(() => {
  const images = album.value?.images ?? [];
  const start = (currentPage.value - 1) * PAGE_SIZE;
  return images.slice(start, start + PAGE_SIZE);
});

/** 本地图片 URL（相册目录 /images/albums/<名>/，经 ADR-012 站点资产通道） */
function imageUrl(image: string): string {
  return imageSrc(`/images/albums/${albumName.value}/${image}`);
}

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
    currentPage.value = 1;
    failedThumbs.value = {};
  } catch (e) {
    handleError(e, '加载相册详情失败');
  } finally {
    loading.value = false;
  }
}

function triggerUpload(): void {
  fileInputRef.value?.click();
}

/**
 * [B3.6] 相册图片上传：走相册专属端点（服务端契约：
 *   POST /admin/albums/:id/images，multipart 字段名 file —— 以
 *   albums.controller.ts 为准），原文件名保存、非 JPG 后端自动转 JPG。
 * 图片只进 public/images/albums/<名>/ 与相册 info，不写入媒体库索引
 *   （P7 偏差 2 边界）；删除同样走相册端点（见 onDeleteImage）。
 */
async function onUploadChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file === undefined) {
    return;
  }
  uploading.value = true;
  try {
    await albumsApi.uploadImage(albumName.value, file);
    ElMessage.success('上传完成');
    await fetchDetail();
  } catch (e) {
    handleError(e, '上传图片失败');
  } finally {
    uploading.value = false;
    input.value = '';
  }
}

/** [B3.6] 编辑对话框日期选择回调：清空回调 null → 空串 */
function onDatePick(value: unknown): void {
  editForm.value.date = typeof value === 'string' ? value : '';
}

/** [R2-8] 打开灯箱：从点击图起播，可在全部图间左右切换 */
function openLightbox(image: string): void {
  const images = (album.value?.images ?? []).map(imageUrl);
  const initial = images.indexOf(imageUrl(image));
  viewerApi({
    images,
    options: {
      inline: false,
      toolbar: true,
      navbar: true,
      title: false,
      keyboard: true,
      movable: true,
      zoomable: true,
      rotatable: true,
      scalable: false,
      transition: true,
      initialViewIndex: initial >= 0 ? initial : 0,
    },
  });
}

/** 缩略图加载失败 → 占位（不破图） */
function onThumbError(image: string): void {
  failedThumbs.value = { ...failedThumbs.value, [image]: true };
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
          <!-- [B3.6] 上传走相册专属端点（不再复用媒体库 ImageUploader） -->
          <input
            ref="fileInputRef"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            hidden
            @change="onUploadChange"
          />
          <el-button :loading="uploading" @click="triggerUpload">上传图片</el-button>
          <el-button @click="openEdit">编辑信息</el-button>
        </div>
      </div>
    </template>
    <el-alert v-if="album !== null" type="info" :closable="false" class="hint">
      非 JPG 图片上传后由后端自动转换为 JPG。
    </el-alert>
    <el-row v-if="album !== null" :gutter="12">
      <el-col v-for="img in pagedImages" :key="img" :span="4">
        <el-card class="image-card" shadow="hover">
          <!-- 点击图片开灯箱（R2-8）；删除按钮独立于点击区 -->
          <div
            class="image-preview"
            role="button"
            tabindex="0"
            :title="`预览 ${img}`"
            @click="openLightbox(img)"
            @keydown.enter="openLightbox(img)"
          >
            <img
              v-if="!failedThumbs[img]"
              :src="imageUrl(img)"
              :alt="img"
              loading="lazy"
              class="thumb"
              @error="onThumbError(img)"
            />
            <div v-else class="thumb-placeholder">
              <span>{{ img }}</span>
            </div>
          </div>
          <div class="image-name">{{ img }}</div>
          <el-button size="small" type="danger" @click="onDeleteImage(img)">删除</el-button>
        </el-card>
      </el-col>
      <el-col v-if="album.images.length === 0" :span="24">
        <el-empty description="暂无图片" />
      </el-col>
    </el-row>

    <!-- [R2-14 前端分页] 每页 60 张；单页时隐藏 -->
    <div v-if="album !== null && album.images.length > PAGE_SIZE" class="pager-row">
      <el-pagination
        v-model:current-page="currentPage"
        :page-size="PAGE_SIZE"
        :total="album.images.length"
        layout="prev, pager, next, total"
        background
      />
    </div>

    <el-dialog v-model="editVisible" title="编辑相册信息" width="500px">
      <el-form label-width="80px">
        <el-form-item label="标题" required>
          <el-input v-model="editForm.title" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editForm.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="日期">
          <!-- [B3.6] el-date-picker（YYYY-MM-DD）替代裸 el-input -->
          <el-date-picker
            :model-value="editForm.date || undefined"
            type="date"
            value-format="YYYY-MM-DD"
            format="YYYY-MM-DD"
            placeholder="选择日期"
            class="date-input"
            @update:model-value="onDatePick"
          />
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
.date-input {
  width: 100%;
}
.hint {
  margin-bottom: 12px;
}
.image-card {
  text-align: center;
  margin-bottom: 12px;
}
.image-preview {
  cursor: zoom-in;
  width: 100%;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  border-radius: 8px;
  background: var(--el-fill-color-light);
  display: flex;
  align-items: center;
  justify-content: center;
}
.thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.thumb-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 8px;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  word-break: break-all;
}
.image-name {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin: 8px 0;
  word-break: break-all;
}
.pager-row {
  display: flex;
  justify-content: center;
  margin-top: 16px;
}
</style>
