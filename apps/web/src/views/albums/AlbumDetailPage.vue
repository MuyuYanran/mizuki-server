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
import { albumsApi, type AlbumView, type AlbumInfo, type ExternalPhoto } from '../../api/albums';
import { ApiError } from '../../api/http';
import { imageSrc } from '../../lib/image-src';
import MediaPicker, { type MediaPickResult } from '../../components/MediaPicker.vue';
import { notifyApiError } from '../../lib/notify';
import { dateOrEmpty } from '../../lib/format';

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

/** [Phase3-C4/ADR-019] 网格缩略图分流标记：-thumb.webp 加载失败 → 回退原图 */
const thumbFallback = ref<Record<string, boolean>>({});

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

/**
 * [Phase3-C4/ADR-019] 网格缩略图 URL：同名 <去扩展名>-thumb.webp（服务端上传
 * 管线派生产物，经既有 /site-assets 路径直达）；灯箱/编辑一律用原图。
 */
function thumbUrl(image: string): string {
  const dot = image.lastIndexOf('.');
  const base = dot > 0 ? image.slice(0, dot) : image;
  return imageSrc(`/images/albums/${albumName.value}/${base}-thumb.webp`);
}

/** 网格实际加载 URL：变体缺失（如 bmp 不生成/存量未回填）回退原图，不报错 */
function gridUrl(image: string): string {
  return thumbFallback.value[image] === true ? imageUrl(image) : thumbUrl(image);
}

interface EditForm {
  title: string;
  description: string;
  date: string;
  location: string;
  layout: string;
  /** [Phase3-C2a] 列数（el-input-number 1-6；null=继承默认 3） */
  columns: number | null;
  /** [Phase3-C2a] hidden:true 隐藏（不出现在公开列表，非访问控制） */
  hidden: boolean;
  /** [Phase4-D2/#5] 相册模式（可切换；服务端双向 409 守卫：本地非空禁切外链、外链非空禁切本地） */
  mode: 'local' | 'external';
  /** [Phase4-D2/#5] 外链模式封面（主题渲染链必需；切换/维持外链时必填） */
  cover: string;
}

const editVisible = ref(false);
const saving = ref(false);
const editForm = ref<EditForm>({
  title: '',
  description: '',
  date: '',
  location: '',
  layout: '',
  columns: null,
  hidden: false,
  mode: 'local',
  cover: '',
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
    thumbFallback.value = {};
  } catch (e) {
    notifyApiError(e, '加载相册详情失败');
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
    notifyApiError(e, '上传图片失败');
  } finally {
    uploading.value = false;
    input.value = '';
  }
}

/** [B3.6] 编辑对话框日期选择回调：清空回调 null → 空串 */
function onDatePick(value: unknown): void {
  editForm.value.date = dateOrEmpty(value);
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

/** [Phase3-C4/ADR-019] 网格变体加载失败 → 回退原图（两级：原图再失败才占位） */
function onGridImageError(image: string): void {
  if (thumbFallback.value[image] !== true) {
    thumbFallback.value = { ...thumbFallback.value, [image]: true };
  } else {
    onThumbError(image);
  }
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
    notifyApiError(e, '删除图片失败');
  }
}

// ── [Phase3-C2a] 外链照片管理（仅 mode === 'external'） ──

/** 外链照片编辑表单（settings 四子键平铺为独立输入框） */
interface PhotoForm {
  id: string;
  src: string;
  thumbnail: string;
  alt: string;
  title: string;
  description: string;
  tags: string;
  date: string;
  location: string;
  width: string;
  height: string;
  camera: string;
  lens: string;
  aperture: string;
  shutter: string;
  iso: string;
  focal: string;
}

const externalPhotos = computed(() => album.value?.info.photos ?? []);

/** [Phase4-D2/T4] 外链照片新增/编辑对话框的选图入口 */
const photoPickerVisible = ref(false);

/** 选图结果回填 src（URL 中心形态；media/album → 站点 URL，external → 原样） */
function onPhotoPicked(results: MediaPickResult[]): void {
  const first = results[0];
  if (first !== undefined) {
    photoForm.value.src = first.url;
  }
}

const photoDialogVisible = ref(false);
const photoEditingIndex = ref<number | null>(null);
const photoSaving = ref(false);
const photoForm = ref<PhotoForm>(emptyPhotoForm());

function emptyPhotoForm(): PhotoForm {
  return {
    id: '',
    src: '',
    thumbnail: '',
    alt: '',
    title: '',
    description: '',
    tags: '',
    date: '',
    location: '',
    width: '',
    height: '',
    camera: '',
    lens: '',
    aperture: '',
    shutter: '',
    iso: '',
    focal: '',
  };
}

function openPhotoAdd(): void {
  photoEditingIndex.value = null;
  photoForm.value = emptyPhotoForm();
  photoDialogVisible.value = true;
}

function openPhotoEdit(index: number): void {
  const photo = externalPhotos.value[index];
  if (photo === undefined) {
    return;
  }
  photoEditingIndex.value = index;
  photoForm.value = {
    id: photo.id ?? '',
    src: photo.src,
    thumbnail: photo.thumbnail ?? '',
    alt: photo.alt ?? '',
    title: photo.title ?? '',
    description: photo.description ?? '',
    tags: (photo.tags ?? []).join(', '),
    date: photo.date ?? '',
    location: photo.location ?? '',
    width: photo.width !== undefined ? String(photo.width) : '',
    height: photo.height !== undefined ? String(photo.height) : '',
    camera: photo.camera ?? '',
    lens: photo.lens ?? '',
    aperture: photo.settings?.aperture ?? '',
    shutter: photo.settings?.shutter ?? '',
    iso: photo.settings?.iso ?? '',
    focal: photo.settings?.focal ?? '',
  };
  photoDialogVisible.value = true;
}

/** 表单 → ExternalPhoto（空串/NaN 字段跳过，settings 有键才写入） */
function buildPhoto(form: PhotoForm): ExternalPhoto {
  const photo: ExternalPhoto = { src: form.src.trim() };
  if (form.id !== '') photo.id = form.id.trim();
  if (form.thumbnail !== '') photo.thumbnail = form.thumbnail.trim();
  if (form.alt !== '') photo.alt = form.alt.trim();
  if (form.title !== '') photo.title = form.title.trim();
  if (form.description !== '') photo.description = form.description.trim();
  if (form.tags.trim() !== '') {
    photo.tags = form.tags
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter((t) => t !== '');
  }
  if (form.date !== '') photo.date = form.date.trim();
  if (form.location !== '') photo.location = form.location.trim();
  if (form.width !== '') {
    const w = Number(form.width);
    if (Number.isFinite(w) && w > 0) photo.width = Math.floor(w);
  }
  if (form.height !== '') {
    const h = Number(form.height);
    if (Number.isFinite(h) && h > 0) photo.height = Math.floor(h);
  }
  if (form.camera !== '') photo.camera = form.camera.trim();
  if (form.lens !== '') photo.lens = form.lens.trim();
  const settings: NonNullable<ExternalPhoto['settings']> = {};
  if (form.aperture !== '') settings.aperture = form.aperture.trim();
  if (form.shutter !== '') settings.shutter = form.shutter.trim();
  if (form.iso !== '') settings.iso = form.iso.trim();
  if (form.focal !== '') settings.focal = form.focal.trim();
  if (Object.keys(settings).length > 0) photo.settings = settings;
  return photo;
}

async function onPhotoSave(): Promise<void> {
  if (photoForm.value.src.trim() === '') {
    ElMessage.warning('请输入图片链接（src）');
    return;
  }
  photoSaving.value = true;
  try {
    const photo = buildPhoto(photoForm.value);
    if (photoEditingIndex.value === null) {
      await albumsApi.addExternalPhoto(albumName.value, photo);
    } else {
      await albumsApi.updateExternalPhoto(albumName.value, photoEditingIndex.value, photo);
    }
    ElMessage.success('已保存');
    photoDialogVisible.value = false;
    await fetchDetail();
  } catch (e) {
    notifyApiError(e, '保存照片失败');
  } finally {
    photoSaving.value = false;
  }
}

async function onPhotoDelete(index: number): Promise<void> {
  const photo = externalPhotos.value[index];
  try {
    await ElMessageBox.confirm(
      `确定删除照片「${photo?.title ?? photo?.src ?? index}」？`,
      '删除确认',
      { type: 'warning' },
    );
  } catch {
    return;
  }
  try {
    await albumsApi.deleteExternalPhoto(albumName.value, index);
    ElMessage.success('已删除');
    await fetchDetail();
  } catch (e) {
    notifyApiError(e, '删除照片失败');
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
    columns: info.columns ?? null,
    hidden: info.hidden === true,
    mode: info.mode ?? 'local',
    cover: info.cover ?? '',
  };
  editVisible.value = true;
}

async function onSaveEdit(): Promise<void> {
  if (editForm.value.title.trim() === '') {
    ElMessage.warning('请输入标题');
    return;
  }
  // [Phase4-D2/#5] 切往（或维持）外链模式必须带 cover（服务端 external schema 必需）
  if (editForm.value.mode === 'external' && editForm.value.cover.trim() === '') {
    ElMessage.warning('外链模式相册必须填写封面地址（cover）');
    return;
  }
  saving.value = true;
  try {
    const patch: Partial<AlbumInfo> = {
      title: editForm.value.title,
      description: editForm.value.description || undefined,
      date: editForm.value.date || undefined,
      location: editForm.value.location || undefined,
      layout: (editForm.value.layout || undefined) as AlbumInfo['layout'],
      columns: editForm.value.columns ?? undefined,
      // [Phase4-D4/A1] hidden 双态显式入 PATCH body（走查①）：此前 false → undefined
      // 被 JSON 序列化丢键，spread 合并保留既有 true → 隐藏开关只能开不能关。
      // 服务端 AlbumInfoSchema.hidden 可空布尔，false 合法（公开语义 hidden !== true）。
      hidden: editForm.value.hidden,
      mode: editForm.value.mode,
      cover: editForm.value.mode === 'external' ? editForm.value.cover.trim() : undefined,
    };
    await albumsApi.update(albumName.value, patch);
    ElMessage.success('已保存');
    editVisible.value = false;
    await fetchDetail();
  } catch (e) {
    // 模式切换守卫（本地非空 → 409 等）由服务端返回，消息含现存数量
    notifyApiError(e, '保存失败');
  } finally {
    saving.value = false;
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
              :src="gridUrl(img)"
              :alt="img"
              loading="lazy"
              class="thumb"
              @error="onGridImageError(img)"
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

    <!-- [Phase3-C2a] 外链相册照片管理（仅 mode === 'external'） -->
    <template v-if="album !== null && album.info.mode === 'external'">
      <el-divider content-position="left">外链照片</el-divider>
      <el-row :gutter="12">
        <el-col v-for="(photo, index) in album.info.photos ?? []" :key="index" :span="6">
          <el-card class="photo-card" shadow="hover">
            <img
              :src="photo.src"
              :alt="photo.alt ?? photo.title ?? photo.src"
              loading="lazy"
              class="photo-thumb"
            />
            <div class="photo-title">{{ photo.title ?? '(无标题)' }}</div>
            <div class="photo-src">{{ photo.src }}</div>
            <div class="photo-actions">
              <el-button size="small" @click="openPhotoEdit(index)">编辑</el-button>
              <el-button size="small" type="danger" @click="onPhotoDelete(index)">删除</el-button>
            </div>
          </el-card>
        </el-col>
        <el-col v-if="(album.info.photos ?? []).length === 0" :span="24">
          <el-empty description="暂无外链照片" />
        </el-col>
        <el-col :span="24" class="photo-add-row">
          <el-button type="primary" plain @click="openPhotoAdd">新增外链照片</el-button>
        </el-col>
      </el-row>
    </template>

    <el-dialog v-model="editVisible" title="编辑相册信息" width="500px">
      <el-form label-width="80px">
        <!-- [Phase4-D2/#5] 模式切换入口（空本地相册可切外链后增补外链图；
             非空相册切换由服务端 409 拒绝并提示现存数量——主题双路渲染契约） -->
        <el-form-item label="模式">
          <el-radio-group v-model="editForm.mode">
            <el-radio value="local">本地上传</el-radio>
            <el-radio value="external">外链图片</el-radio>
          </el-radio-group>
          <div class="field-hint">双向切换：本地目录非空禁切外链、外链照片非空禁切本地（409）</div>
        </el-form-item>
        <el-form-item v-if="editForm.mode === 'external'" label="封面" required>
          <el-input v-model="editForm.cover" placeholder="https://... 或 /images/..." />
        </el-form-item>
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
          <el-select v-model="editForm.layout" clearable placeholder="grid / masonry" class="full-width">
            <el-option label="grid" value="grid" />
            <el-option label="masonry" value="masonry" />
          </el-select>
        </el-form-item>
        <el-form-item label="列数">
          <el-input-number v-model="editForm.columns" :min="1" :max="6" :controls="true" class="full-width" />
        </el-form-item>
        <el-form-item label="隐藏">
          <el-switch v-model="editForm.hidden" />
          <span class="field-hint">隐藏后不出现在公开相册列表（文件仍保留）</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSaveEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- [Phase3-C2a] 外链照片编辑对话框（官方 14 字段；settings 四子键独立输入框） -->
    <el-dialog
      v-model="photoDialogVisible"
      :title="photoEditingIndex === null ? '新增外链照片' : '编辑外链照片'"
      width="640px"
    >
      <el-form label-width="90px">
        <el-form-item label="链接(src)" required>
          <div class="src-row">
            <el-input v-model="photoForm.src" placeholder="https://... 或 /images/..." />
            <!-- [Phase4-D2/T4] 从媒体库/相册/外链选图回填 src（增补选图入口） -->
            <el-button @click="photoPickerVisible = true">选图</el-button>
          </div>
        </el-form-item>
        <el-form-item label="ID">
          <el-input v-model="photoForm.id" />
        </el-form-item>
        <el-form-item label="缩略图">
          <el-input v-model="photoForm.thumbnail" placeholder="https://..." />
        </el-form-item>
        <el-form-item label="替代文本">
          <el-input v-model="photoForm.alt" />
        </el-form-item>
        <el-form-item label="标题">
          <el-input v-model="photoForm.title" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="photoForm.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="photoForm.tags" placeholder="逗号分隔" />
        </el-form-item>
        <el-form-item label="拍摄日期">
          <el-input v-model="photoForm.date" placeholder="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="拍摄地点">
          <el-input v-model="photoForm.location" />
        </el-form-item>
        <el-form-item label="宽 / 高">
          <el-input v-model="photoForm.width" placeholder="宽度" class="wh-input" />
          <el-input v-model="photoForm.height" placeholder="高度" class="wh-input" />
        </el-form-item>
        <el-form-item label="相机">
          <el-input v-model="photoForm.camera" />
        </el-form-item>
        <el-form-item label="镜头">
          <el-input v-model="photoForm.lens" />
        </el-form-item>
        <el-form-item label="拍摄参数">
          <el-input v-model="photoForm.aperture" placeholder="光圈 f/8" class="wh-input" />
          <el-input v-model="photoForm.shutter" placeholder="快门 1/125" class="wh-input" />
          <el-input v-model="photoForm.iso" placeholder="ISO 200" class="wh-input" />
          <el-input v-model="photoForm.focal" placeholder="焦距 35mm" class="wh-input" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="photoDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="photoSaving" @click="onPhotoSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- [Phase4-D2/T4] 外链照片 src 选图入口（媒体库/相册/外链三 tab） -->
    <MediaPicker v-model="photoPickerVisible" title="选择图片（回填 src）" @picked="onPhotoPicked" />
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
.full-width {
  width: 100%;
}
.field-hint {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.photo-card {
  margin-bottom: 12px;
  text-align: center;
}
.photo-thumb {
  width: 100%;
  height: 120px;
  object-fit: cover;
  border-radius: 6px;
  background: var(--el-fill-color-light);
}
.photo-title {
  font-weight: 600;
  font-size: 13px;
  margin: 8px 0 4px;
  word-break: break-all;
}
.photo-src {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  word-break: break-all;
  margin-bottom: 8px;
}
.photo-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
}
.photo-add-row {
  margin-top: 4px;
}
.wh-input {
  width: 120px;
  margin-right: 8px;
}
/* [Phase4-D2/T4] src 输入 + 选图按钮同行 */
.src-row {
  display: flex;
  gap: 8px;
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
