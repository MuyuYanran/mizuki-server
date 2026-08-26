<script setup lang="ts">
/**
 * [P10d] 引用明细对话框（删除被引用资源时 409 展示）
 * [职责] 展示后端 409 detail.references（refType + targetLabel 列表），
 *   说明为何禁止删除。纯文本展示，无 v-html（§5 专属禁止）。
 * [状态] ACTIVE
 */
import { type MediaReference } from '../api/media';

defineProps<{
  modelValue: boolean;
  references: MediaReference[];
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

/** refType → 中文标签（后端贡献者约定值；未知值原样显示） */
const REF_TYPE_LABELS: Record<string, string> = {
  'post-cover': '文章封面',
  'article-cover': '富文本封面',
  'diary-image': '日记图片',
  'project-image': '项目图片',
  'device-image': '设备图片',
};

function labelFor(refType: string): string {
  return REF_TYPE_LABELS[refType] ?? refType;
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="无法删除：存在引用"
    width="480px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p class="hint">该资源被以下内容引用，删除前请先移除引用：</p>
    <el-table :data="references" border size="small">
      <el-table-column label="引用类型">
        <template #default="{ row }">{{ labelFor(row.refType) }}</template>
      </el-table-column>
      <el-table-column label="目标" prop="targetLabel" />
    </el-table>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">知道了</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  margin: 0 0 12px;
  color: #606266;
}
</style>
