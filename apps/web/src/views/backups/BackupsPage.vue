<script setup lang="ts">
/**
 * [P10d] 备份与恢复页面
 * [职责] 列表（scope/文件数/大小/时间/备注）、创建（scope 选择 + 备注）、
 *   恢复（二次确认 + 明确提示"将覆盖当前内容" + 说明覆盖前自动快照）、删除（二次确认）。
 * [状态] ACTIVE
 */
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { backupsApi, type BackupRecordInfo, type BackupScope } from '../../api/backups';
import { ApiError } from '../../api/http';

const list = ref<BackupRecordInfo[]>([]);
const loading = ref(false);
const creating = ref(false);

const createVisible = ref(false);
const createForm = ref<{ scope: BackupScope; note: string }>({ scope: 'full', note: '' });

const SCOPE_OPTIONS: { value: BackupScope; label: string }[] = [
  { value: 'full', label: '全量（数据文件 + 内容）' },
  { value: 'data', label: '数据文件（src/data）' },
  { value: 'content', label: '内容目录（src/content）' },
  { value: 'db', label: '数据库' },
];

function scopeLabel(scope: string): string {
  return SCOPE_OPTIONS.find((o) => o.value === scope)?.label ?? scope;
}

async function fetchList(): Promise<void> {
  loading.value = true;
  try {
    list.value = await backupsApi.list();
  } catch (e) {
    handleError(e, '加载备份列表失败');
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  createForm.value = { scope: 'full', note: '' };
  createVisible.value = true;
}

async function onCreate(): Promise<void> {
  creating.value = true;
  try {
    await backupsApi.create(createForm.value.scope, createForm.value.note || undefined);
    ElMessage.success('备份创建成功');
    createVisible.value = false;
    await fetchList();
  } catch (e) {
    handleError(e, '创建备份失败');
  } finally {
    creating.value = false;
  }
}

async function onRestore(record: BackupRecordInfo): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定恢复备份「${record.id}」（${scopeLabel(record.scope)}）？\n\n⚠️ 此操作将覆盖当前内容。恢复前系统会自动创建当前状态的快照，可用于回滚。`,
      '恢复确认',
      { type: 'warning', confirmButtonText: '确认恢复', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    const result = await backupsApi.restore(record.id);
    const msg = result.safetyBackupId
      ? `恢复完成（${result.restoredFiles} 个文件），已自动创建恢复前快照`
      : `恢复完成（${result.restoredFiles} 个文件）`;
    ElMessage.success(msg);
    await fetchList();
  } catch (e) {
    handleError(e, '恢复失败');
  }
}

async function onDelete(record: BackupRecordInfo): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除备份「${record.id}」？此操作不可撤销。`, '删除确认', {
      type: 'warning',
    });
  } catch {
    return;
  }
  try {
    await backupsApi.remove(record.id);
    ElMessage.success('已删除');
    await fetchList();
  } catch (e) {
    handleError(e, '删除失败');
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
        <span>备份与恢复</span>
        <el-button type="primary" @click="openCreate">创建备份</el-button>
      </div>
    </template>
    <el-table :data="list" border>
      <el-table-column label="ID" prop="id" width="200" />
      <el-table-column label="范围">
        <template #default="{ row }">{{ scopeLabel(row.scope) }}</template>
      </el-table-column>
      <el-table-column label="文件数" prop="fileCount" width="90" />
      <el-table-column label="大小" width="110">
        <template #default="{ row }">{{ formatSize(row.sizeBytes) }}</template>
      </el-table-column>
      <el-table-column label="时间" width="190">
        <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="备注" prop="note" />
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="onRestore(row)">恢复</el-button>
          <el-button size="small" type="danger" @click="onDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="createVisible" title="创建备份" width="440px">
      <el-form label-width="80px">
        <el-form-item label="范围">
          <el-select v-model="createForm.scope">
            <el-option v-for="opt in SCOPE_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="createForm.note" placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="onCreate">创建</el-button>
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
</style>
