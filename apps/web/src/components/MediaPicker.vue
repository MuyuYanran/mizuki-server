<script setup lang="ts">
/**
 * [Phase4-D2/ADR-022] 统一媒体选择器（Element Plus 自研组合，零新增依赖）
 * [职责] 三 tab 供图：媒体库（media_file 网格 + 现场上传）/ 相册（相册 → 图片
 *   两级选择）/ 外链 URL 直填；确定后 emit picked(PickResult[])。
 * [返回形态定稿（T1.4，单形态 + 消费方适配）] 组件只回 **URL 中心形态**：
 *   媒体库/相册图 → 站点 URL（/images/...）；外链 → http(s) 原样或站点绝对路径。
 *   markdown 片段组装归编辑器消费方（media-ref.markdownImageRef），表单回填
 *   消费方直接取 url。数组统一形态承载批量需求（单选场景长度 1）。
 * [状态] ACTIVE
 */
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { mediaApi, type MediaInfo } from '../api/media';
import { albumsApi, type AlbumView } from '../api/albums';
import { imageSrc } from '../lib/image-src';
import { isExternalUrl, toSiteReference } from '../lib/media-ref';
import ImageUploader from './ImageUploader.vue';

/** 选择结果（URL 中心形态；source 标明来源 tab，path/name 供消费方展示或组 alt） */
export interface MediaPickResult {
  url: string;
  source: 'media' | 'album' | 'external';
  /** 来源媒体的 API 原始 path（仅 media 来源） */
  path?: string;
  /** 展示名（媒体原名 / 相册图片文件名） */
  name?: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    /** 多选（媒体库/相册 tab 生效；外链 tab 走多行 URL） */
    multiple?: boolean;
    title?: string;
  }>(),
  {
    multiple: false,
    title: '选择图片',
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'picked', results: MediaPickResult[]): void;
}>();

const activeTab = ref<'media' | 'album' | 'external'>('media');
const mediaList = ref<MediaInfo[]>([]);
const albumList = ref<AlbumView[]>([]);
const loading = ref(false);

/** 已选集合（键 = url；单选时至多 1 项） */
const selected = ref<Map<string, MediaPickResult>>(new Map());
/** 相册 tab 二级选择 */
const selectedAlbumName = ref('');
const albumImages = ref<string[]>([]);
/** 外链直填（单选 = 单行；多选 = 多行） */
const externalInput = ref('');

/** 打开时懒加载两域列表（每次打开刷新，上传/删除后所见即所得） */
watch(
  () => props.modelValue,
  (open) => {
    if (!open) {
      return;
    }
    selected.value = new Map();
    selectedAlbumName.value = '';
    albumImages.value = [];
    externalInput.value = '';
    activeTab.value = 'media';
    void loadLists();
  },
);

async function loadLists(): Promise<void> {
  loading.value = true;
  try {
    const [media, albums] = await Promise.all([mediaApi.list(), albumsApi.list()]);
    mediaList.value = media;
    albumList.value = albums;
  } catch {
    ElMessage.error('媒体/相册列表加载失败');
  } finally {
    loading.value = false;
  }
}

function onUploaded(): void {
  void loadLists();
}

/** 媒体库条目 → PickResult */
function pickMedia(media: MediaInfo): void {
  toggle({ url: toSiteReference(media.path), source: 'media', path: media.path, name: media.originalName });
}

/** 相册图片 → PickResult（站点 URL 形态，与主题本地相册渲染 URL 同构） */
function pickAlbumImage(image: string): void {
  toggle({
    url: toSiteReference(`/images/albums/${selectedAlbumName.value}/${image}`),
    source: 'album',
    name: image,
  });
}

function toggle(result: MediaPickResult): void {
  const next = new Map(selected.value);
  if (next.has(result.url)) {
    next.delete(result.url);
  } else if (props.multiple) {
    next.set(result.url, result);
  } else {
    next.clear();
    next.set(result.url, result);
  }
  selected.value = next;
}

function selectAlbum(name: string): void {
  selectedAlbumName.value = name;
  albumImages.value = albumList.value.find((a) => a.name === name)?.images ?? [];
}

/** 外链输入解析（trim 归一；空行忽略；非 http(s)/站点绝对路径拒绝） */
function parseExternal(): MediaPickResult[] {
  const lines = props.multiple
    ? externalInput.value.split('\n')
    : [externalInput.value];
  const results: MediaPickResult[] = [];
  for (const raw of lines) {
    const url = toSiteReference(raw);
    if (url === '/') {
      continue; // 空行归一忽略
    }
    if (!isExternalUrl(url) && !url.startsWith('/')) {
      ElMessage.warning(`外链地址不合法：${raw.trim()}（须为 http(s) URL 或 / 开头站点路径）`);
      return [];
    }
    results.push({ url, source: 'external' });
  }
  if (results.length === 0) {
    ElMessage.warning('请输入图片地址');
    return [];
  }
  return results;
}

function onConfirm(): void {
  if (activeTab.value === 'external') {
    const results = parseExternal();
    if (results.length === 0) {
      return;
    }
    emit('picked', results);
    emit('update:modelValue', false);
    return;
  }
  if (selected.value.size === 0) {
    ElMessage.warning('请先选择图片');
    return;
  }
  emit('picked', [...selected.value.values()]);
  emit('update:modelValue', false);
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="props.title"
    width="760px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-tabs v-model="activeTab">
      <el-tab-pane label="媒体库" name="media">
        <div class="picker-toolbar">
          <ImageUploader multiple label="上传到媒体库" @uploaded="onUploaded" />
          <span v-if="props.multiple" class="picker-hint">已选 {{ selected.size }} 张（可多选）</span>
        </div>
        <div v-loading="loading" class="picker-grid">
          <div
            v-for="media in mediaList"
            :key="media.id"
            class="picker-cell"
            :class="{ picked: selected.has(toSiteReference(media.path)) }"
            role="button"
            tabindex="0"
            :title="media.originalName"
            @click="pickMedia(media)"
            @keydown.enter="pickMedia(media)"
          >
            <img :src="imageSrc(media.path)" :alt="media.originalName" loading="lazy" class="picker-thumb" />
            <div class="picker-name">{{ media.originalName }}</div>
          </div>
          <el-empty v-if="mediaList.length === 0" description="媒体库为空，可先上传" />
        </div>
      </el-tab-pane>

      <el-tab-pane label="相册" name="album">
        <div class="picker-toolbar">
          <el-select
            :model-value="selectedAlbumName"
            placeholder="选择相册"
            class="album-select"
            @update:model-value="selectAlbum"
          >
            <el-option v-for="album in albumList" :key="album.name" :label="album.info.title" :value="album.name" />
          </el-select>
          <span v-if="props.multiple" class="picker-hint">已选 {{ selected.size }} 张（可多选）</span>
        </div>
        <div v-if="selectedAlbumName === ''" class="picker-grid">
          <el-empty description="请先选择相册" />
        </div>
        <div v-else v-loading="loading" class="picker-grid">
          <div
            v-for="image in albumImages"
            :key="image"
            class="picker-cell"
            :class="{ picked: selected.has(toSiteReference(`/images/albums/${selectedAlbumName}/${image}`)) }"
            role="button"
            tabindex="0"
            :title="image"
            @click="pickAlbumImage(image)"
            @keydown.enter="pickAlbumImage(image)"
          >
            <img
              :src="imageSrc(`/images/albums/${selectedAlbumName}/${image}`)"
              :alt="image"
              loading="lazy"
              class="picker-thumb"
            />
            <div class="picker-name">{{ image }}</div>
          </div>
          <el-empty v-if="albumImages.length === 0" description="该相册暂无本地图（外链模式相册请用外链 tab）" />
        </div>
      </el-tab-pane>

      <el-tab-pane label="外链" name="external">
        <el-input
          v-if="!props.multiple"
          v-model="externalInput"
          placeholder="https://... 或站点绝对路径 /images/..."
          clearable
        />
        <el-input
          v-else
          v-model="externalInput"
          type="textarea"
          :rows="6"
          placeholder="每行一个地址（http(s) URL 或 / 开头站点路径），空行忽略"
        />
        <div class="picker-hint external-hint">https 部署下 http 外链图可能被浏览器混合内容策略拦截</div>
      </el-tab-pane>
    </el-tabs>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" @click="onConfirm">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.picker-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.album-select {
  width: 240px;
}
.picker-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.external-hint {
  margin-top: 8px;
}
.picker-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
  max-height: 46vh;
  overflow-y: auto;
  min-height: 120px;
}
.picker-cell {
  border: 2px solid transparent;
  border-radius: 8px;
  padding: 4px;
  cursor: pointer;
  background: var(--el-fill-color-light);
}
.picker-cell.picked {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.picker-thumb {
  width: 100%;
  height: 72px;
  object-fit: cover;
  border-radius: 6px;
  display: block;
}
.picker-name {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
