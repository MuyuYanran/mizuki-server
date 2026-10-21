<script setup lang="ts">
/**
 * [U3-P4b/K4] 主题漂移呈现面板（`/theme-status`，E3b）——**纯前端消费**既有端点，
 * 后端零改动：
 * - `GET /admin/theme/status`（theme.controller.ts:20-24）→ `ThemeStatusView`；
 * - `POST /admin/theme/capture`（:26-31，201）→ 最新 `ThemeStatusView`。
 * [职责] 五段只读呈现：身份 / 指纹 / 基线四态 / 漂移三态 / 探针结果。
 *   `capture` 是页面**唯一**写操作，且只写服务端漂移基线文件（不改主题源码）；
 *   双轴正交：它重置漂移轴，探针轴不受影响（探针失败仍会以 409 阻断物化写入）。
 * [边界] 零新依赖（无图表库）：表格 `el-table`、字段 `el-descriptions`、状态 `el-tag`；
 *   不落 localStorage / cookie（前端零持久化）；诊断文本（`baseline.detail` /
 *   探针 detail / 错误 message）一律经 `maskInternalPaths` 投影，禁整段渲染绝对路径。
 * [状态] ACTIVE
 */
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FingerprintEntry, ThemeDriftItem, ThemeStatusView } from '@mizuki/shared';
import { themeApi } from '../../api/theme';
import { ApiError } from '../../api/http';
import { maskInternalPaths } from '../../lib/mask-path';
import { notifyApiError } from '../../lib/notify';

/** 指纹条目 role 四值中文（展示层词，按 K9 留在页面内，不进 shared） */
const ROLE_LABELS: Record<FingerprintEntry['role'], string> = {
  'materialization-carrier': '物化载体',
  identity: '身份文件',
  'structure-assumption': '结构假设',
  'token-source': '样式源',
};

/** 基线四态中文（R3 分派表逐一列名；absent 是起始态、**非错误**） */
const BASELINE_STATE_LABELS: Record<ThemeStatusView['baseline']['state'], string> = {
  absent: '未捕获',
  loaded: '正常',
  'version-mismatch': '档案版本失配',
  'parse-error': '解析失败',
};

const BASELINE_STATE_TAGS: Record<
  ThemeStatusView['baseline']['state'],
  'success' | 'warning' | 'danger' | 'info'
> = {
  absent: 'info',
  loaded: 'success',
  'version-mismatch': 'warning',
  'parse-error': 'danger',
};

/** 漂移三态中文 */
const DRIFT_STATE_LABELS: Record<ThemeStatusView['drift']['state'], string> = {
  'no-baseline': '无基线',
  clean: '零漂移',
  drifted: '存在漂移',
};

/** 漂移三态标签色（no-baseline 是「缺对照」而非通过 → info；clean 才绿） */
const DRIFT_STATE_TAGS: Record<
  ThemeStatusView['drift']['state'],
  'success' | 'warning' | 'info'
> = {
  'no-baseline': 'info',
  clean: 'success',
  drifted: 'warning',
};

/** 漂移项 kind 三值中文 */
const DRIFT_KIND_LABELS: Record<ThemeDriftItem['kind'], string> = {
  added: '新增',
  removed: '移除',
  modified: '变更',
};

/** 探针失败门禁三步（静态复述 PROBE_GATE_GUIDANCE，不新增端点） */
const PROBE_GATE_STEPS: string[] = [
  '① 重新捕获基线（仅重置漂移轴——诊断用，探针轴不受影响）',
  '② 核对并修订 Tier 1 档案（packages/shared/src/theme-profile.ts 与 docs/profiles/mizuki-tier1.md 派生件同步）',
  '③ 评估物化适配性：确认 site-config 受控子集写入器与新主题结构兼容后再放行',
];

const loading = ref(false);
const capturing = ref(false);
const view = ref<ThemeStatusView | null>(null);
/** 页面空态文案（`GET status` 失败时只渲染它，不渲染半截表格） */
const loadError = ref<string | null>(null);

/** 无数据时的占位视图：模板只经 `status` 取值，避免在模板里做可空收窄 */
const EMPTY_VIEW: ThemeStatusView = {
  identity: { name: null, version: null, fallback: 'fingerprint' },
  fingerprint: { scannedAt: '', digest: '', entries: [] },
  baseline: { state: 'absent', profileVersion: null, capturedAt: null, detail: null },
  drift: { state: 'no-baseline', items: [] },
  probes: [],
};

const status = computed<ThemeStatusView>(() => view.value ?? EMPTY_VIEW);
const hasView = computed<boolean>(() => view.value !== null);

/** 身份降级：package.json 缺 name/version → 以指纹代身份 */
const identityDegraded = computed<boolean>(() => status.value.identity.fallback === 'fingerprint');

/** 指纹表格行（sha256 只显前 12 位；目录级条目 null → 明示不指纹） */
interface FingerprintRow {
  path: string;
  role: string;
  present: string;
  sha256: string;
}

const fingerprintRows = computed<FingerprintRow[]>(() =>
  status.value.fingerprint.entries.map((entry) => ({
    path: entry.path,
    role: ROLE_LABELS[entry.role],
    present: entry.present ? '存在' : '缺失',
    sha256: shortSha(entry.sha256),
  })),
);

/** 漂移表格行（不加空表：`no-baseline` 时不渲染表格，见模板） */
interface DriftRow {
  path: string;
  kind: string;
}

const driftRows = computed<DriftRow[]>(() =>
  status.value.drift.items.map((item) => ({
    path: item.path,
    kind: DRIFT_KIND_LABELS[item.kind],
  })),
);

/** 探针表格行（detail 经内部路径投影） */
interface ProbeRow {
  target: string;
  passed: string;
  detail: string;
}

const probeRows = computed<ProbeRow[]>(() =>
  status.value.probes.map((probe) => ({
    target: probe.target,
    passed: probe.passed ? '通过' : '失败',
    detail: maskInternalPaths(probe.detail),
  })),
);

const probeTotal = computed<number>(() => status.value.probes.length);
const probePassed = computed<number>(
  () => status.value.probes.filter((probe) => probe.passed).length,
);
const probeAllPassed = computed<boolean>(
  () => probeTotal.value > 0 && probePassed.value === probeTotal.value,
);
const hasProbeFailure = computed<boolean>(() => probePassed.value < probeTotal.value);

/** 探针徽标色：全绿才 success；空集（0/0）用 info，不假装通过也不误报失败 */
const probeTagType = computed<'success' | 'danger' | 'info'>(() => {
  if (probeTotal.value === 0) {
    return 'info';
  }
  return probeAllPassed.value ? 'success' : 'danger';
});

/** 基线诊断明细（掩蔽后；空串 = 无明细） */
const baselineDetail = computed<string>(() => maskInternalPaths(status.value.baseline.detail));

/** 基线状态标签：absent 显式标注「非错误」（起始态，不是异常） */
const baselineStateLabel = computed<string>(() =>
  status.value.baseline.state === 'absent'
    ? '未捕获（非错误）'
    : BASELINE_STATE_LABELS[status.value.baseline.state],
);

/** 漂移状态标签：drifted 直接列出项数（`漂移 N 项`），另两态用固定词 */
const driftStateLabel = computed<string>(() =>
  status.value.drift.state === 'drifted'
    ? `漂移 ${status.value.drift.items.length} 项`
    : DRIFT_STATE_LABELS[status.value.drift.state],
);

/** sha256 前 12 位 + 省略号；null = 目录级（不指纹） */
function shortSha(sha: string | null): string {
  return sha === null ? '不指纹（目录级）' : `${sha.slice(0, 12)}…`;
}

async function fetchStatus(): Promise<void> {
  loading.value = true;
  try {
    view.value = await themeApi.getStatus();
    loadError.value = null;
  } catch (e) {
    view.value = null;
    loadError.value =
      e instanceof ApiError && e.status === 404
        ? '主题目录未配置（服务端 404）：请先在「设置」或初始化向导完成主题目录配置'
        : e instanceof ApiError
          ? maskInternalPaths(e.message)
          : '加载主题状态失败，请确认后端服务可用后重试';
    notifyApiError(e, '加载主题状态失败');
  } finally {
    loading.value = false;
  }
}

/**
 * 捕获基线 = 页面唯一写操作（K6）：
 * 二次确认 → 成功用**响应体**渲染 + success；失败只报错、**不得**显示已捕获；
 * `finally` **无条件**再 GET 一次（写失败也要回到服务端真源）。
 */
async function onCapture(): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    '将用当前主题指纹覆盖漂移基线（仅重置漂移诊断，不改主题源码；探针轴不受影响）。确定继续？',
    '捕获基线确认',
    { type: 'warning', confirmButtonText: '确认捕获', cancelButtonText: '取消' },
  )
    .then(() => true)
    .catch(() => false);
  if (!confirmed) {
    return;
  }
  capturing.value = true;
  try {
    const next = await themeApi.capture();
    view.value = next;
    loadError.value = null;
    ElMessage.success('基线已捕获（漂移轴已重置）');
  } catch (e) {
    // 500 InternalError（写盘异常）绝不进成功分支：view 保持原值，随后 finally 再取真源
    notifyApiError(e, '捕获基线失败');
  } finally {
    capturing.value = false;
    await fetchStatus();
  }
}

onMounted(() => {
  void fetchStatus();
});
</script>

<template>
  <div v-loading="loading" class="theme-status-page panel-card">
    <div class="page-header">
      <div class="page-heading">
        <h2 class="page-title">主题状态</h2>
        <span class="page-subtitle">主题身份 / 指纹 / 漂移基线 / 声明探针（只读诊断）</span>
      </div>
      <div class="page-actions">
        <el-button :loading="loading" @click="fetchStatus">刷新</el-button>
        <el-button
          type="primary"
          class="btn-gradient-primary"
          :loading="capturing"
          :disabled="loading"
          @click="onCapture"
        >
          捕获基线（重置漂移轴）
        </el-button>
      </div>
    </div>

    <!-- [K8] 空态：加载失败只给结论与下一步，不渲染半截表格 -->
    <el-alert
      v-if="loadError !== null && !hasView"
      type="warning"
      :closable="false"
      show-icon
      title="主题状态不可得"
      :description="loadError"
      class="page-alert"
    />

    <template v-if="hasView">
      <!-- ① 身份 -->
      <section class="status-section">
        <h3 class="section-title">身份</h3>
        <el-descriptions :column="3" border>
          <el-descriptions-item label="名称">
            {{ status.identity.name ?? '未知' }}
          </el-descriptions-item>
          <el-descriptions-item label="版本">
            {{ status.identity.version ?? '未知' }}
          </el-descriptions-item>
          <el-descriptions-item label="身份来源">
            <el-tag v-if="identityDegraded" type="warning" size="small">
              身份降级：以指纹代身份
            </el-tag>
            <el-tag v-else type="success" size="small">package.json</el-tag>
          </el-descriptions-item>
        </el-descriptions>
        <p v-if="identityDegraded" class="section-hint">
          主题 package.json 缺 name/version（或不可读），身份由指纹摘要代偿：身份判定仍然可靠，
          但与主题自报版本号的对照不可用。
        </p>
      </section>

      <!-- ② 指纹 -->
      <section class="status-section">
        <h3 class="section-title">指纹</h3>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="扫描时间">
            {{ status.fingerprint.scannedAt || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="摘要（digest）">
            <code class="digest">{{ status.fingerprint.digest || '—' }}</code>
          </el-descriptions-item>
        </el-descriptions>
        <el-table :data="fingerprintRows" size="small" class="section-table">
          <el-table-column prop="path" label="路径" min-width="280" />
          <el-table-column prop="role" label="角色" width="110" />
          <el-table-column prop="present" label="存在" width="90" />
          <el-table-column prop="sha256" label="sha256（前 12 位）" min-width="180" />
        </el-table>
      </section>

      <!-- ③ 基线（四态：absent 是起始态、非错误） -->
      <section class="status-section">
        <h3 class="section-title">基线</h3>
        <el-descriptions :column="3" border>
          <el-descriptions-item label="状态">
            <el-tag :type="BASELINE_STATE_TAGS[status.baseline.state]" size="small">
              {{ baselineStateLabel }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="档案版本">
            {{ status.baseline.profileVersion ?? '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="捕获时间">
            {{ status.baseline.capturedAt ?? '—' }}
          </el-descriptions-item>
        </el-descriptions>
        <div v-if="baselineDetail !== ''" class="detail-block">
          <span class="detail-label">诊断明细</span>
          <pre class="detail-pre">{{ baselineDetail }}</pre>
        </div>
        <p v-if="status.baseline.state === 'absent'" class="section-hint">
          尚未捕获基线：这是起始态而非错误。漂移轴暂无对照，点「捕获基线（重置漂移轴）」建立快照。
        </p>
        <p v-else-if="status.baseline.state === 'version-mismatch'" class="section-hint warn">
          档案版本已变更（Tier 1 档案更新）：请重新捕获基线；旧基线会一直失配。物化写入门禁仍由探针轴把关。
        </p>
        <p v-else-if="status.baseline.state === 'parse-error'" class="section-hint warn">
          基线文件无法解析：可重新捕获覆盖；若仍失败请检查基线文件内容与权限。当前漂移轴按「无基线」处理。
        </p>
      </section>

      <!-- ④ 漂移（三态：no-baseline 不渲染空表） -->
      <section class="status-section">
        <h3 class="section-title">漂移</h3>
        <div class="section-badge">
          <el-tag :type="DRIFT_STATE_TAGS[status.drift.state]" size="small">
            {{ driftStateLabel }}
          </el-tag>
        </div>
        <p v-if="status.drift.state === 'no-baseline'" class="section-hint">
          无基线：先捕获基线，之后才有漂移对照（此处不渲染空表）。
        </p>
        <p v-else-if="status.drift.state === 'clean'" class="section-hint">
          零漂移：当前主题指纹与基线完全一致。
        </p>
        <el-table v-else :data="driftRows" size="small" class="section-table">
          <el-table-column prop="path" label="路径" min-width="320" />
          <el-table-column prop="kind" label="类型" width="120" />
        </el-table>
      </section>

      <!-- ⑤ 探针（执法轴：与漂移轴正交，capture 不会让它变绿） -->
      <section class="status-section">
        <h3 class="section-title">探针</h3>
        <div class="section-badge">
          <el-tag :type="probeTagType" size="small">
            {{ probePassed }}/{{ probeTotal }} 通过
          </el-tag>
        </div>
        <el-alert
          v-if="hasProbeFailure"
          type="warning"
          :closable="false"
          show-icon
          title="探针失败会阻断物化写入（409）"
          class="page-alert"
        >
          <p class="probe-guidance">
            失败项会进写入门禁详情（409）。处置三步（静态指引，无需另开端点）：
          </p>
          <ul class="probe-steps">
            <li v-for="step in PROBE_GATE_STEPS" :key="step">{{ step }}</li>
          </ul>
        </el-alert>
        <el-table :data="probeRows" size="small" class="section-table">
          <el-table-column prop="target" label="目标" min-width="200" />
          <el-table-column prop="passed" label="结果" width="90" />
          <el-table-column prop="detail" label="明细" min-width="320" />
        </el-table>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.page-heading {
  display: flex;
  flex-direction: column;
  gap: 4px;
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
}
.page-actions {
  display: flex;
  gap: 8px;
}
.page-alert {
  margin-bottom: 16px;
  border-radius: var(--mizuki-radius-control);
}
.status-section {
  margin-bottom: 22px;
}
.section-title {
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}
.section-table {
  margin-top: 10px;
}
.section-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.section-hint {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
.section-hint.warn {
  color: var(--el-color-warning);
}
.digest {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  word-break: break-all;
}
.detail-block {
  margin-top: 10px;
}
.detail-label {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.detail-pre {
  margin: 0;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  border-radius: var(--el-border-radius-small);
  background: var(--el-fill-color-light);
}
.probe-guidance {
  margin: 0 0 6px;
  font-size: 12px;
  line-height: 1.6;
}
.probe-steps {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.7;
}
</style>
