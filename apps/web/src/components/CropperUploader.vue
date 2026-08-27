<script setup lang="ts">
/**
 * [Phase2-B1 / R2-6] 通用图片裁切上传组件（vue-cropper 封装）
 * [职责] 选择图片 → 弹窗裁切（预设比例可传参）→ 输出 → 走既有媒体上传链路
 *   （POST /admin/media）→ emit 'uploaded'（MediaInfo，父级回填表单字段）。
 * 复用接口（R2-6「预留媒体库、日记图片复用」）：
 *   - fixedNumber：裁切框固定比例（默认 1:1）；
 *   - round：预览是否圆形（友链头像 true）；
 *   - outputType：裁切产物格式（png 默认 / jpeg / webp）；
 *   - upload：上传函数（默认媒体库上传，可替换为相册上传等）。
 * [状态] ACTIVE
 */
import { ref } from 'vue';
import { VueCropper } from 'vue-cropper';
import 'vue-cropper/dist/index.css';
import { ElMessage } from 'element-plus';
import { mediaApi, type MediaInfo } from '../api/media';

/** vue-cropper 实例方法面（官方 d.ts 未暴露方法，按运行时实现结构声明） */
interface CropperInstance {
  getCropBlob: (callback: (blob: Blob) => void) => void;
}

const props = withDefaults(
  defineProps<{
    /** 按钮文案 */
    label?: string;
    /** 裁切框固定比例 [宽, 高]（默认 1:1；友链头像圆形 1:1） */
    fixedNumber?: [number, number];
    /** 预览是否圆形渲染（头像场景 true） */
    round?: boolean;
    /** 裁切产物格式（vue-cropper outputType） */
    outputType?: 'png' | 'jpeg' | 'webp';
    /** 上传函数（默认媒体库上传；复用方可替换，如相册上传） */
    upload?: (file: File) => Promise<MediaInfo>;
  }>(),
  {
    label: '裁切上传图片',
    fixedNumber: () => [1, 1] as [number, number],
    round: true,
    outputType: 'png',
    upload: undefined,
  },
);

const emit = defineEmits<{
  (e: 'uploaded', media: MediaInfo): void;
}>();

const dialogVisible = ref(false);
const cropperRef = ref<unknown>(null);
const rawImage = ref('');
const sourceName = ref('image');
const cropping = ref(false);

/** 隐藏文件选择 */
function trigger(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp,image/gif';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    sourceName.value = file.name.replace(/\.[^.]+$/, '') || 'image';
    const reader = new FileReader();
    reader.onload = () => {
      rawImage.value = String(reader.result ?? '');
      dialogVisible.value = true;
    };
    reader.onerror = () => {
      ElMessage.error('读取图片失败');
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

/** 确认裁切 → blob → File → 上传 → 通知父级 */
function confirmCrop(): void {
  const cropper = cropperRef.value as CropperInstance | null;
  if (cropper === null) {
    return;
  }
  cropping.value = true;
  cropper.getCropBlob((blob) => {
    const ext = props.outputType === 'jpeg' ? 'jpg' : props.outputType;
    const file = new File([blob], `${sourceName.value}-cropped.${ext}`, {
      type: blob.type || `image/${props.outputType}`,
    });
    const uploader = props.upload ?? mediaApi.upload.bind(mediaApi);
    uploader(file)
      .then((media) => {
        ElMessage.success(`已上传：${media.path}`);
        emit('uploaded', media);
        dialogVisible.value = false;
      })
      .catch((error: unknown) => {
        ElMessage.error(error instanceof Error ? error.message : '上传失败');
      })
      .finally(() => {
        cropping.value = false;
      });
  });
}
</script>

<template>
  <div class="cropper-uploader">
    <el-button :loading="cropping" @click="trigger">{{ props.label }}</el-button>

    <el-dialog v-model="dialogVisible" title="裁切图片" width="640px" :close-on-click-modal="false">
      <div class="cropper-body">
        <VueCropper
          ref="cropperRef"
          :img="rawImage"
          :output-type="props.outputType"
          :auto-crop="true"
          :auto-crop-width="240"
          :auto-crop-height="240"
          :fixed="true"
          :fixed-number="props.fixedNumber"
          :center-box="true"
          :can-move="true"
          :can-move-box="true"
          :high="true"
          :info="true"
          :mode="'contain'"
        />
      </div>
      <p class="crop-hint">
        裁切框比例已锁定为 {{ props.fixedNumber[0] }}:{{ props.fixedNumber[1] }}；
        确认后上传到媒体库并回填路径。
      </p>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="cropping" @click="confirmCrop">确认并上传</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.cropper-uploader {
  display: inline-block;
}
.cropper-body {
  width: 100%;
  height: 380px;
}
.crop-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
