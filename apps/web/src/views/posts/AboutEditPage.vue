<script setup lang="ts">
/**
 * [P10c] about 页编辑器（§3.2，REQUIREMENTS §6.11）
 * [职责] CodeMirror 6 复用，编辑 src/content/spec/about.md；
 *   保存调 PUT /admin/about（后端写前自动备份）；展示「已自动备份」提示；
 *   「上传替换」入口读本地 .md 文本后走同一保存链路。
 * [状态] ACTIVE
 */
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { CodeMirrorEditor } from '../../lib/editors';
import { postsApi } from '../../api/posts';
import { ApiError } from '../../api/http';

const content = ref('');
const loading = ref(false);
const saving = ref(false);
const backupHint = ref('');

onMounted(async () => {
  loading.value = true;
  try {
    const result = await postsApi.readAbout();
    content.value = result.content;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      content.value = '';
    } else {
      ElMessage.error(err instanceof ApiError ? err.message : '加载失败');
    }
  } finally {
    loading.value = false;
  }
});

async function onSave(): Promise<void> {
  saving.value = true;
  backupHint.value = '';
  try {
    await postsApi.writeAbout(content.value);
    ElMessage.success('保存成功');
    backupHint.value = '已自动备份';
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

/** 上传替换 */
function onUploadReplace(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file === undefined) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result;
    if (typeof text === 'string') {
      content.value = text;
      ElMessage.success('已替换内容，点击保存生效');
    }
  };
  reader.readAsText(file);
  input.value = '';
}
</script>

<template>
  <div class="about-edit-page" v-loading="loading">
    <div class="page-header">
      <h2>关于页编辑</h2>
      <div class="header-actions">
        <label class="upload-btn">
          <span>上传替换</span>
          <input type="file" accept=".md,.markdown,.txt" hidden @change="onUploadReplace" />
        </label>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </div>
    </div>

    <el-alert
      v-if="backupHint !== ''"
      type="success"
      :title="backupHint"
      :closable="true"
      show-icon
      style="margin-bottom: 12px"
    />

    <CodeMirrorEditor :model-value="content" @update:model-value="content = $event" />
  </div>
</template>

<style scoped>
.about-edit-page {
  padding: 16px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.page-header h2 {
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.upload-btn {
  display: inline-block;
  cursor: pointer;
  color: var(--el-color-primary);
  font-size: 13px;
}
</style>
