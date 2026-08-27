<script setup lang="ts">
/**
 * [P10d] 仪表盘页面（替换 P10a DashboardPlaceholder）
 * [职责] 统计卡片（服务状态/文章数/草稿数/日记数/友链数/相册数/备份状态/版本/运行时长）
 *   + 最近操作日志（GET /admin/system/logs）。进入拉取 + 手动刷新（ADR-008 不实现 SSE）。
 * [状态] ACTIVE
 */
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { fetchDashboardData, type DashboardData } from '../api/dashboard';

const data = ref<DashboardData | null>(null);
const loading = ref(false);

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    data.value = await fetchDashboardData();
  } catch {
    ElMessage.error('加载仪表盘数据失败');
  } finally {
    loading.value = false;
  }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN');
}

function latestBackupTime(): string {
  const latest = data.value?.recentBackups[0];
  return latest ? formatTime(latest.createdAt) : '无备份';
}

function uptimeText(): string {
  const seconds = data.value?.status?.uptime;
  if (seconds === undefined) return '—';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

onMounted(() => {
  void refresh();
});
</script>

<template>
  <div v-loading="loading">
    <div class="page-header">
      <span>仪表盘</span>
      <el-button size="small" @click="refresh">刷新</el-button>
    </div>
    <el-row :gutter="12" class="cards">
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-label">服务状态</div>
          <div class="stat-value">{{ data?.status?.initialized ? '已初始化' : '未初始化' }}</div>
          <div class="stat-sub">模式：{{ data?.status?.mode ?? '—' }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-label">文章数</div>
          <div class="stat-value">{{ data?.postCount ?? '—' }}</div>
          <div class="stat-sub">草稿：{{ data?.draftCount ?? 0 }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-label">日记数</div>
          <div class="stat-value">{{ data?.diaryCount ?? '—' }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-label">友链数</div>
          <div class="stat-value">{{ data?.friendsCount ?? '—' }}</div>
        </el-card>
      </el-col>
    </el-row>
    <el-row :gutter="12" class="cards">
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-label">相册数</div>
          <div class="stat-value">{{ data?.albumCount ?? '—' }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-label">备份状态</div>
          <div class="stat-value">{{ data?.recentBackups.length ?? 0 }} 份</div>
          <div class="stat-sub">{{ latestBackupTime() }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-label">服务版本</div>
          <div class="stat-value">{{ data?.status?.version ?? '—' }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-label">运行时长</div>
          <div class="stat-value">{{ uptimeText() }}</div>
        </el-card>
      </el-col>
    </el-row>
    <el-card class="logs-card">
      <template #header>最近操作日志</template>
      <el-table :data="data?.recentLogs ?? []" border size="small">
        <el-table-column label="时间" width="190">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="方法" prop="method" width="80" />
        <el-table-column label="路径" prop="path" />
        <el-table-column label="操作" prop="action" width="100" />
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.cards {
  margin-bottom: 12px;
}
.stat-card {
  text-align: center;
}
.stat-label {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.stat-value {
  font-size: 24px;
  font-weight: 700;
  margin: 4px 0;
}
.stat-sub {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.logs-card {
  margin-top: 12px;
}
</style>
