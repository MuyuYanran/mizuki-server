<script setup lang="ts">
/**
 * [P10d] 仪表盘页面
 * [UI-U1] 观感升级：大圆角统计卡片 + 悬浮上浮 + 主色渐变高亮 + 柔边表格。
 * [UI-U2 / T3] 工作台模式：自由画布（FloatCanvas）+ 9 张 FloatCard 自由拖动与缩放 + 布局持久化 + 一键重置。
 * [状态] ACTIVE
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { fetchDashboardData, type DashboardData } from '../api/dashboard';
import { formatTime } from '../lib/format';
import { FloatCard, useFloatCard, type FloatRect } from '../lib/float';

const STORAGE_KEY = 'mizuki.layout.dashboard.v1';

const data = ref<DashboardData | null>(null);
const loading = ref(false);

const canvasRef = ref<HTMLElement | null>(null);
const canvasWidth = ref(1160);
const floatEnabled = ref(true);

function updateCanvasBounds(): void {
  if (canvasRef.value) {
    canvasWidth.value = canvasRef.value.clientWidth || 1160;
  }
  floatEnabled.value = typeof window !== 'undefined' && window.innerWidth >= 1280;
}

const boundsGetter = () => ({
  w: canvasWidth.value,
  h: canvasHeight.value,
});

const enabledGetter = () => floatEnabled.value;

/** 按当前画布宽计算 4 列 × 2 行 + 满宽日志卡的默认布局（复刻 U1 现状） */
function computeDefaults(): Record<string, FloatRect> {
  const w = canvasWidth.value;
  const colW = Math.max(260, Math.floor((w - 16 * 3) / 4));
  const rowH = 140;
  const gap = 16;

  return {
    'stat-status': { x: 0, y: 0, w: colW, h: rowH, z: 100 },
    'stat-posts': { x: colW + gap, y: 0, w: colW, h: rowH, z: 101 },
    'stat-diary': { x: (colW + gap) * 2, y: 0, w: colW, h: rowH, z: 102 },
    'stat-friends': { x: (colW + gap) * 3, y: 0, w: colW, h: rowH, z: 103 },
    'stat-albums': { x: 0, y: rowH + gap, w: colW, h: rowH, z: 104 },
    'stat-backups': { x: colW + gap, y: rowH + gap, w: colW, h: rowH, z: 105 },
    'stat-version': { x: (colW + gap) * 2, y: rowH + gap, w: colW, h: rowH, z: 106 },
    'stat-uptime': { x: (colW + gap) * 3, y: rowH + gap, w: colW, h: rowH, z: 107 },
    'recent-ops': { x: 0, y: (rowH + gap) * 2, w: Math.max(360, w), h: 360, z: 108 },
  };
}

const initialDefaults = computeDefaults();

// 9 张卡片的 float 状态
const cardStatus = useFloatCard({
  id: 'stat-status',
  storageKey: STORAGE_KEY,
  defaults: initialDefaults['stat-status']!,
  bounds: boundsGetter,
  enabled: enabledGetter,
});

const cardPosts = useFloatCard({
  id: 'stat-posts',
  storageKey: STORAGE_KEY,
  defaults: initialDefaults['stat-posts']!,
  bounds: boundsGetter,
  enabled: enabledGetter,
});

const cardDiary = useFloatCard({
  id: 'stat-diary',
  storageKey: STORAGE_KEY,
  defaults: initialDefaults['stat-diary']!,
  bounds: boundsGetter,
  enabled: enabledGetter,
});

const cardFriends = useFloatCard({
  id: 'stat-friends',
  storageKey: STORAGE_KEY,
  defaults: initialDefaults['stat-friends']!,
  bounds: boundsGetter,
  enabled: enabledGetter,
});

const cardAlbums = useFloatCard({
  id: 'stat-albums',
  storageKey: STORAGE_KEY,
  defaults: initialDefaults['stat-albums']!,
  bounds: boundsGetter,
  enabled: enabledGetter,
});

const cardBackups = useFloatCard({
  id: 'stat-backups',
  storageKey: STORAGE_KEY,
  defaults: initialDefaults['stat-backups']!,
  bounds: boundsGetter,
  enabled: enabledGetter,
});

const cardVersion = useFloatCard({
  id: 'stat-version',
  storageKey: STORAGE_KEY,
  defaults: initialDefaults['stat-version']!,
  bounds: boundsGetter,
  enabled: enabledGetter,
});

const cardUptime = useFloatCard({
  id: 'stat-uptime',
  storageKey: STORAGE_KEY,
  defaults: initialDefaults['stat-uptime']!,
  bounds: boundsGetter,
  enabled: enabledGetter,
});

const cardLogs = useFloatCard({
  id: 'recent-ops',
  storageKey: STORAGE_KEY,
  defaults: initialDefaults['recent-ops']!,
  min: { w: 360, h: 240 },
  bounds: boundsGetter,
  enabled: enabledGetter,
});

const allCards = [
  cardStatus,
  cardPosts,
  cardDiary,
  cardFriends,
  cardAlbums,
  cardBackups,
  cardVersion,
  cardUptime,
  cardLogs,
];

/** id → 卡片状态映射（[UI-U2fix] 重排/钳制时按 id 批量寻址） */
const cardById: Record<string, (typeof allCards)[number]> = {
  'stat-status': cardStatus,
  'stat-posts': cardPosts,
  'stat-diary': cardDiary,
  'stat-friends': cardFriends,
  'stat-albums': cardAlbums,
  'stat-backups': cardBackups,
  'stat-version': cardVersion,
  'stat-uptime': cardUptime,
  'recent-ops': cardLogs,
};

/** 动态计算画布自适应总高度（包容所有卡片底部 + 留白） */
const canvasHeight = computed(() => {
  if (!floatEnabled.value) return 0;
  let maxBottom = 820;
  for (const c of allCards) {
    const bottom = c.rect.value.y + c.rect.value.h + 24;
    if (bottom > maxBottom) maxBottom = bottom;
  }
  return maxBottom;
});

/** 一键重置布局（K4） */
function resetLayout(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 容错
  }
  const defs = computeDefaults();
  cardStatus.reset(defs['stat-status']);
  cardPosts.reset(defs['stat-posts']);
  cardDiary.reset(defs['stat-diary']);
  cardFriends.reset(defs['stat-friends']);
  cardAlbums.reset(defs['stat-albums']);
  cardBackups.reset(defs['stat-backups']);
  cardVersion.reset(defs['stat-version']);
  cardUptime.reset(defs['stat-uptime']);
  cardLogs.reset(defs['recent-ops']);
  ElMessage.success('布局已重置');
}

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

function onWindowResize(): void {
  handleCanvasMaybeChanged();
}

/** [UI-U2fix] 画布宽实际变化时：未自定义的卡片按实测宽重排 + 已保存卡片钳回画布内 */
function handleCanvasMaybeChanged(): void {
  const el = canvasRef.value;
  const w = el ? el.clientWidth : canvasWidth.value;
  if (Math.abs(w - canvasWidth.value) < 1) return;
  updateCanvasBounds();
  const defs = computeDefaults();
  for (const [id, card] of Object.entries(cardById)) {
    const d = defs[id];
    if (d) {
      card.applyDefaultsIfPristine(d);
    }
    card.reclamp();
  }
}

let canvasObserver: ResizeObserver | null = null;

onMounted(() => {
  // [UI-U2fix] 修正 setup 期 1160 兜底宽算出的初始默认布局（缺陷①根因：
  // initialDefaults 在挂载前计算，此前从不重排，导致每次进页卡片不对齐）。
  // 注意：这里不能先调 updateCanvasBounds() —— 它会把 canvasWidth 同步成实测宽，
  // 使 handleCanvasMaybeChanged 的宽度变化守卫（|w - canvasWidth| < 1）恒成立而
  // 提前返回，重排永不执行（2026-10-18 浏览器实测复现：切页返回仍停在 278px
  // 兜底布局）。正确顺序：直接调 handleCanvasMaybeChanged，让守卫看到
  // 「1160 兜底 vs 实测宽」的差异，由其内部完成 updateCanvasBounds + 按实测宽
  // 重排 pristine 卡片 + reclamp 已保存卡片。
  handleCanvasMaybeChanged();
  // ResizeObserver：窗口调整、侧栏折叠（U1）等一切画布宽变化都触发自适应；
  // 高度回写（canvasHeight 反算）因宽度守卫不会形成回环
  if (typeof ResizeObserver !== 'undefined' && canvasRef.value) {
    canvasObserver = new ResizeObserver(handleCanvasMaybeChanged);
    canvasObserver.observe(canvasRef.value);
  } else {
    window.addEventListener('resize', onWindowResize);
  }
  void refresh();
});

onBeforeUnmount(() => {
  canvasObserver?.disconnect();
  canvasObserver = null;
  window.removeEventListener('resize', onWindowResize);
});
</script>

<template>
  <div v-loading="loading" class="dashboard-page panel-card">
    <div class="page-header">
      <div class="header-left">
        <h2 class="page-title">系统仪表盘</h2>
        <span class="page-subtitle">工作台自由画布 · 随意拖拽卡片与调整尺寸</span>
      </div>
      <div class="header-actions">
        <el-button size="default" class="reset-btn" title="清空自定义位置并恢复默认排布" @click="resetLayout">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          重置布局
        </el-button>
        <el-button size="default" class="refresh-btn btn-gradient-primary" @click="refresh">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          刷新数据
        </el-button>
      </div>
    </div>

    <!-- 自由画布容器 -->
    <div
      ref="canvasRef"
      class="float-canvas"
      :class="{ 'is-floating': floatEnabled }"
      :style="floatEnabled ? { height: `${canvasHeight}px` } : {}"
    >
      <!-- 1. 服务状态 -->
      <FloatCard
        title="服务状态"
        :rect="cardStatus.rect.value"
        :is-dragging="cardStatus.isDragging.value"
        :is-resizing="cardStatus.isResizing.value"
        :enabled="floatEnabled"
        @header-pointer-down="cardStatus.onHeaderPointerDown"
        @handle-pointer-down="cardStatus.onHandlePointerDown"
        @card-click="cardStatus.bringToFront"
      >
        <div class="stat-content">
          <div class="stat-value" :class="{ 'is-ok': data?.status?.initialized }">
            {{ data?.status?.initialized ? '已初始化' : '未初始化' }}
          </div>
          <div class="stat-sub">模式：{{ data?.status?.mode ?? '—' }}</div>
        </div>
      </FloatCard>

      <!-- 2. 文章数 -->
      <FloatCard
        title="文章数"
        :rect="cardPosts.rect.value"
        :is-dragging="cardPosts.isDragging.value"
        :is-resizing="cardPosts.isResizing.value"
        :enabled="floatEnabled"
        @header-pointer-down="cardPosts.onHeaderPointerDown"
        @handle-pointer-down="cardPosts.onHandlePointerDown"
        @card-click="cardPosts.bringToFront"
      >
        <div class="stat-content">
          <div class="stat-value primary-gradient">{{ data?.postCount ?? '—' }}</div>
          <div class="stat-sub">草稿：{{ data?.draftCount ?? 0 }} 篇</div>
        </div>
      </FloatCard>

      <!-- 3. 日记数 -->
      <FloatCard
        title="日记数"
        :rect="cardDiary.rect.value"
        :is-dragging="cardDiary.isDragging.value"
        :is-resizing="cardDiary.isResizing.value"
        :enabled="floatEnabled"
        @header-pointer-down="cardDiary.onHeaderPointerDown"
        @handle-pointer-down="cardDiary.onHandlePointerDown"
        @card-click="cardDiary.bringToFront"
      >
        <div class="stat-content">
          <div class="stat-value primary-gradient">{{ data?.diaryCount ?? '—' }}</div>
          <div class="stat-sub">日常记录条目</div>
        </div>
      </FloatCard>

      <!-- 4. 友链数 -->
      <FloatCard
        title="友链数"
        :rect="cardFriends.rect.value"
        :is-dragging="cardFriends.isDragging.value"
        :is-resizing="cardFriends.isResizing.value"
        :enabled="floatEnabled"
        @header-pointer-down="cardFriends.onHeaderPointerDown"
        @handle-pointer-down="cardFriends.onHandlePointerDown"
        @card-click="cardFriends.bringToFront"
      >
        <div class="stat-content">
          <div class="stat-value primary-gradient">{{ data?.friendsCount ?? '—' }}</div>
          <div class="stat-sub">博客小伙伴</div>
        </div>
      </FloatCard>

      <!-- 5. 相册数 -->
      <FloatCard
        title="相册数"
        :rect="cardAlbums.rect.value"
        :is-dragging="cardAlbums.isDragging.value"
        :is-resizing="cardAlbums.isResizing.value"
        :enabled="floatEnabled"
        @header-pointer-down="cardAlbums.onHeaderPointerDown"
        @handle-pointer-down="cardAlbums.onHandlePointerDown"
        @card-click="cardAlbums.bringToFront"
      >
        <div class="stat-content">
          <div class="stat-value primary-gradient">{{ data?.albumCount ?? '—' }}</div>
          <div class="stat-sub">公开与精选合集</div>
        </div>
      </FloatCard>

      <!-- 6. 备份状态 -->
      <FloatCard
        title="备份状态"
        :rect="cardBackups.rect.value"
        :is-dragging="cardBackups.isDragging.value"
        :is-resizing="cardBackups.isResizing.value"
        :enabled="floatEnabled"
        @header-pointer-down="cardBackups.onHeaderPointerDown"
        @handle-pointer-down="cardBackups.onHandlePointerDown"
        @card-click="cardBackups.bringToFront"
      >
        <div class="stat-content">
          <div class="stat-value primary-gradient">{{ data?.recentBackups.length ?? 0 }} 份</div>
          <div class="stat-sub">{{ latestBackupTime() }}</div>
        </div>
      </FloatCard>

      <!-- 7. 服务版本 -->
      <FloatCard
        title="服务版本"
        :rect="cardVersion.rect.value"
        :is-dragging="cardVersion.isDragging.value"
        :is-resizing="cardVersion.isResizing.value"
        :enabled="floatEnabled"
        @header-pointer-down="cardVersion.onHeaderPointerDown"
        @handle-pointer-down="cardVersion.onHandlePointerDown"
        @card-click="cardVersion.bringToFront"
      >
        <div class="stat-content">
          <div class="stat-value">{{ data?.status?.version ?? '—' }}</div>
          <div class="stat-sub">Mizuki-Server</div>
        </div>
      </FloatCard>

      <!-- 8. 运行时长 -->
      <FloatCard
        title="运行时长"
        :rect="cardUptime.rect.value"
        :is-dragging="cardUptime.isDragging.value"
        :is-resizing="cardUptime.isResizing.value"
        :enabled="floatEnabled"
        @header-pointer-down="cardUptime.onHeaderPointerDown"
        @handle-pointer-down="cardUptime.onHandlePointerDown"
        @card-click="cardUptime.bringToFront"
      >
        <div class="stat-content">
          <div class="stat-value">{{ uptimeText() }}</div>
          <div class="stat-sub">持续稳定运行</div>
        </div>
      </FloatCard>

      <!-- 9. 最近操作日志 -->
      <FloatCard
        title="最近操作日志"
        :rect="cardLogs.rect.value"
        :is-dragging="cardLogs.isDragging.value"
        :is-resizing="cardLogs.isResizing.value"
        :enabled="floatEnabled"
        class="logs-float-card"
        @header-pointer-down="cardLogs.onHeaderPointerDown"
        @handle-pointer-down="cardLogs.onHandlePointerDown"
        @card-click="cardLogs.bringToFront"
      >
        <el-table :data="data?.recentLogs ?? []" size="small" class="logs-table">
          <el-table-column label="时间" width="180">
            <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="方法" prop="method" width="90">
            <template #default="{ row }">
              <el-tag
                size="small"
                :type="row.method === 'GET' ? 'info' : row.method === 'POST' ? 'success' : row.method === 'DELETE' ? 'danger' : 'warning'"
              >
                {{ row.method }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="路径" prop="path" />
          <el-table-column label="操作" prop="action" width="120" />
        </el-table>
      </FloatCard>
    </div>
  </div>
</template>

<style scoped>
.dashboard-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: calc(100vh - 100px);
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
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

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.refresh-btn,
.reset-btn {
  display: inline-flex;
  align-items: center;
}

/* ── 自由工作台画布 ── */
.float-canvas {
  width: 100%;
  position: relative;
  box-sizing: border-box;
  transition: height var(--mizuki-motion-base) ease;
}

.float-canvas.is-floating {
  min-height: 800px;
  /* 二次元点阵网格背景（极淡描边色，透明度 ≤ 0.5） */
  background-image: radial-gradient(var(--mizuki-border-hairline) 1.5px, transparent 1.5px);
  background-size: 24px 24px;
  border-radius: var(--mizuki-radius-card);
  padding: 4px;
}

.stat-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  margin: 4px 0;
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

.logs-float-card :deep(.float-card__body) {
  padding: 0;
}

.logs-table {
  width: 100%;
  height: 100%;
}

/* ── <1280px 降级静态网格堆叠 ── */
@media (max-width: 1279px) {
  .float-canvas {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 16px;
    min-height: auto !important;
    height: auto !important;
    background-image: none !important;
  }
  .logs-float-card {
    grid-column: 1 / -1;
  }
}
</style>
