<script setup lang="ts">
/**
 * [P10d] 仪表盘页面（替换 P10a DashboardPlaceholder）
 * [职责] 统计卡片（服务状态/文章数/草稿数/日记数/友链数/相册数/备份状态/版本/运行时长）
 *   + 最近操作日志（GET /admin/system/logs）。进入拉取 + 手动刷新（ADR-008 不实现 SSE）。
 * [Phase4-U1] 观感升级：大圆角统计卡片 + 悬浮上浮 + 主色渐变高亮 + 柔边表格。
 * [状态] ACTIVE
 */
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { fetchDashboardData, type DashboardData } from '../api/dashboard';
import { formatTime } from '../lib/format';

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
  <div v-loading="loading" class="dashboard-page panel-card">
    <div class="page-header">
      <div class="header-left">
        <h2 class="page-title">系统仪表盘</h2>
        <span class="page-subtitle">博客核心状态与最近操作汇总</span>
      </div>
      <el-button size="default" class="refresh-btn btn-gradient-primary" @click="refresh">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;">
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
        刷新数据
      </el-button>
    </div>

    <el-row :gutter="16" class="stat-grid">
      <el-col :xs="12" :sm="6">
        <div class="stat-card">
          <div class="stat-label">服务状态</div>
          <div class="stat-value" :class="{ 'is-ok': data?.status?.initialized }">
            {{ data?.status?.initialized ? '已初始化' : '未初始化' }}
          </div>
          <div class="stat-sub">模式：{{ data?.status?.mode ?? '—' }}</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="6">
        <div class="stat-card">
          <div class="stat-label">文章数</div>
          <div class="stat-value primary-gradient">{{ data?.postCount ?? '—' }}</div>
          <div class="stat-sub">草稿：{{ data?.draftCount ?? 0 }} 篇</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="6">
        <div class="stat-card">
          <div class="stat-label">日记数</div>
          <div class="stat-value primary-gradient">{{ data?.diaryCount ?? '—' }}</div>
          <div class="stat-sub">日常记录条目</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="6">
        <div class="stat-card">
          <div class="stat-label">友链数</div>
          <div class="stat-value primary-gradient">{{ data?.friendsCount ?? '—' }}</div>
          <div class="stat-sub">博客小伙伴</div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="stat-grid">
      <el-col :xs="12" :sm="6">
        <div class="stat-card">
          <div class="stat-label">相册数</div>
          <div class="stat-value primary-gradient">{{ data?.albumCount ?? '—' }}</div>
          <div class="stat-sub">公开与精选合集</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="6">
        <div class="stat-card">
          <div class="stat-label">备份状态</div>
          <div class="stat-value primary-gradient">{{ data?.recentBackups.length ?? 0 }} 份</div>
          <div class="stat-sub">{{ latestBackupTime() }}</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="6">
        <div class="stat-card">
          <div class="stat-label">服务版本</div>
          <div class="stat-value">{{ data?.status?.version ?? '—' }}</div>
          <div class="stat-sub">Mizuki-Server</div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="6">
        <div class="stat-card">
          <div class="stat-label">运行时长</div>
          <div class="stat-value">{{ uptimeText() }}</div>
          <div class="stat-sub">持续稳定运行</div>
        </div>
      </el-col>
    </el-row>

    <div class="logs-section">
      <div class="section-title">最近操作日志</div>
      <el-table :data="data?.recentLogs ?? []" size="default" class="logs-table">
        <el-table-column label="时间" width="200">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="方法" prop="method" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.method === 'GET' ? 'info' : row.method === 'POST' ? 'success' : row.method === 'DELETE' ? 'danger' : 'warning'">
              {{ row.method }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="路径" prop="path" />
        <el-table-column label="操作" prop="action" width="140" />
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.dashboard-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.page-title {
  font-size: 20px;
  font-weight: 700;
  margin: 0;
  color: var(--el-text-color-primary);
}
.page-subtitle {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
  display: inline-block;
}
.refresh-btn {
  display: inline-flex;
  align-items: center;
}
.stat-grid {
  row-gap: 16px;
}
.stat-card {
  padding: 20px;
  border-radius: var(--mizuki-radius-card);
  background: var(--el-fill-color-blank);
  border: 1px solid var(--mizuki-border-hairline);
  box-shadow: var(--mizuki-card-shadow);
  text-align: center;
  transition: transform var(--mizuki-motion-fast) var(--mizuki-motion-spring),
              box-shadow var(--mizuki-motion-fast),
              border-color var(--mizuki-motion-fast);
}
.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--mizuki-lift-shadow);
  border-color: var(--el-color-primary-light-7);
}
.stat-label {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  font-weight: 500;
}
.stat-value {
  font-size: 26px;
  font-weight: 700;
  margin: 8px 0 4px;
  color: var(--el-text-color-primary);
  line-height: 1.2;
}
.stat-value.primary-gradient {
  background: linear-gradient(120deg, var(--el-color-primary), var(--el-color-primary-dark-2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.stat-value.is-ok {
  color: var(--el-color-success);
}
.stat-sub {
  color: var(--el-text-color-placeholder);
  font-size: 12px;
}
.logs-section {
  margin-top: 8px;
}
.section-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--el-text-color-primary);
}
.logs-table {
  width: 100%;
}
</style>
