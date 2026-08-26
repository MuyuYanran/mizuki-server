<script setup lang="ts">
/**
 * [P10d] 图片上传组件（六类内容页与媒体库复用）
 * [职责] 选择图片 → POST /admin/media → emit 'uploaded' 事件（带 MediaInfo）；
 *   父组件据 media.path 回填表单或刷新列表。上传中显示 loading。
 * [状态] ACTIVE
 *
 * 后端校验（魔数/大小/重编码）由 P7 五件套保证；前端只展示错误。
 * 图片静态访问：path 为相对 Mizuki 根的路径（如 public/images/uploads/xxx.jpg），
 *   展示时经 vite dev 代理或后端静态服务（取可用者，见页面层处理）。
 */
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { mediaApi, type MediaInfo } from '../api/media';

const props = withDefaults(
  defineProps<{
    /** 接受的文件类型（默认图片白名单，与后端一致） */
    accept?: string;
    /** 多选上传 */
    multiple?: boolean;
    /** 按钮文案 */
    label?: string;
  }>(),
  {
    accept: 'image/jpeg,image/png,image/webp,image/gif',
    multiple: false,
    label: '上传图片',
  },
);

const emit = defineEmits<{
  (e: 'uploaded', media: MediaInfo): void;
}>();

const uploading = ref(false);
const inputRef = ref<HTMLInputElement | null>(null);

function trigger(): void {
  inputRef.value?.click();
}

async function onChange(e: Event): Promise<void> {
  if (!(e.target instanceof HTMLInputElement)) {
    return;
  }
  const files = e.target.files;
  if (files === null || files.length === 0) {
    return;
  }
  uploading.value = true;
  try {
    for (const file of Array.from(files)) {
      const media = await mediaApi.upload(file);
      emit('uploaded', media);
    }
    ElMessage.success('上传完成');
  } catch (error) {
    const msg = error instanceof Error ? error.message : '上传失败';
    ElMessage.error(msg);
  } finally {
    uploading.value = false;
    e.target.value = ''; // 重置以允许重复选择同文件
  }
}
</script>

<template>
  <div class="image-uploader">
    <input
      ref="inputRef"
      type="file"
      :accept="props.accept"
      :multiple="props.multiple"
      class="file-input"
      @change="onChange"
    />
    <el-button :loading="uploading" @click="trigger">{{ props.label }}</el-button>
  </div>
</template>

<style scoped>
.image-uploader {
  display: inline-block;
}
.file-input {
  display: none;
}
</style>
