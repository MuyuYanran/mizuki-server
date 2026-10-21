<script setup lang="ts">
/**
 * [P10d] 构建预览控制台
 * [职责] 任务按钮（install/dev/build）→ POST /admin/process/tasks；
 *   SSE 日志终端 LogTerminal（taskId 驱动，实时滚动，纯文本禁 v-html）；
 *   停止 DELETE /admin/process/tasks/:id；任务状态徽标（running/exited/killed）；
 *   端口检测 GET /admin/process/ports/:port。
 * [Phase3-C4/ADR-019] 「站点预览」入口：POST preview-ticket（Set-Cookie
 *   mizuki_preview_jwt + 端口下发）→ 新窗口打开 `${protocol}//${hostname}:${port}/`
 *   ——hostname 一律 window.location.hostname 派生（禁硬编码 127.0.0.1），
 *   port 来自票据响应（禁前端硬编码）。白名单 'preview' 任务本体未动。
 * [U3-P3/K6] 控制台增补两区（纯增量，SSE 实时区/启停交互/端口检测一行不动）：
 *   ① 历史记录区——分页表格、查看全文日志 dialog、单条删除（带确认）；
 *   ② 模板区——GET /admin/process/templates 渲染快捷按钮（点击走既有
 *      startTask(task) 白名单链路）；空数组不显示该区。
 * [U3-P4a/K5] 增补第三区「任务环境变量」（与模板区并列，SSE/启停/端口检测仍一行不动）：
 *   掩码表格（key / masked / 删除）+ 新增行（key + 密码框 value）+ 「保存整表」；
 *   值按凭据处理（GET/PUT 都只回掩码），保存前二次确认并列出将被移除的既有键。
 * [状态] ACTIVE
 *
 * SSE 经 fetch 流携带 Bearer token（process.ts）；LogTerminal 在 exit 事件后
 * emit 'finished'，本页据以刷新任务终态。
 */
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { maskTaskEnvValue } from '@mizuki/shared';
import {
  processApi,
  type ProcessTaskName,
  type TaskView,
  type PortProbeResult,
  type TaskRunListItem,
  type TaskTemplate,
  type TaskEnvEntry,
} from '../../api/process';
import { previewApi } from '../../api/preview';
import { ApiError } from '../../api/http';
import LogTerminal from '../../components/LogTerminal.vue';
import { notifyApiError } from '../../lib/notify';
import { formatTime } from '../../lib/format';

const TASK_OPTIONS: { value: ProcessTaskName; label: string }[] = [
  { value: 'install', label: '安装依赖' },
  { value: 'dev', label: '开发预览' },
  { value: 'build', label: '构建' },
];

const STATUS_LABELS: Record<string, string> = {
  running: '运行中',
  exited: '已退出',
  killed: '已停止',
};

const STATUS_TYPES: Record<string, 'success' | 'info' | 'danger'> = {
  running: 'success',
  exited: 'info',
  killed: 'danger',
};

const currentTask = ref<TaskView | null>(null);
const starting = ref(false);

const portInput = ref('');
const portResult = ref<PortProbeResult | null>(null);
const portChecking = ref(false);

/** [Phase3-C4/ADR-019] 站点预览票据签发 → 新窗口打开预览通道 */
const previewOpening = ref(false);

async function openPreview(): Promise<void> {
  previewOpening.value = true;
  try {
    const ticket = await previewApi.issueTicket();
    window.open(
      `${window.location.protocol}//${window.location.hostname}:${ticket.port}/`,
      '_blank',
    );
  } catch (e) {
    notifyApiError(e, '获取站点预览票据失败');
  } finally {
    previewOpening.value = false;
  }
}

async function startTask(task: ProcessTaskName): Promise<void> {
  starting.value = true;
  try {
    currentTask.value = await processApi.startTask(task);
    ElMessage.success(`任务已启动：${task}（pid ${currentTask.value.pid}）`);
  } catch (e) {
    notifyApiError(e, '启动任务失败');
  } finally {
    starting.value = false;
  }
}

async function stopTask(): Promise<void> {
  if (currentTask.value === null) {
    return;
  }
  try {
    currentTask.value = await processApi.stopTask(currentTask.value.id);
    ElMessage.success('停止请求已发出');
  } catch (e) {
    notifyApiError(e, '停止任务失败');
  }
}

/** LogTerminal 收到 exit 事件后通知；刷新任务终态 */
function onFinished(exitCode: number): void {
  if (currentTask.value === null) {
    return;
  }
  const id = currentTask.value.id;
  void processApi
    .getTask(id)
    .then((task) => {
      currentTask.value = task;
    })
    .catch(() => {
      // 任务可能已清理，保守置终态
      if (currentTask.value !== null) {
        currentTask.value = {
          ...currentTask.value,
          status: 'exited',
          exitCode,
          finishedAt: new Date().toISOString(),
        };
      }
    });
}

async function checkPort(): Promise<void> {
  const port = Number(portInput.value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    ElMessage.warning('请输入有效端口（1-65535）');
    return;
  }
  portChecking.value = true;
  try {
    portResult.value = await processApi.probePort(port);
  } catch (e) {
    notifyApiError(e, '端口检测失败');
  } finally {
    portChecking.value = false;
  }
}

// ── [U3-P3/K6] 模板区 ──

/** 任务模板（白名单任务命名预设；点击走既有 startTask 白名单链路） */
const templates = ref<TaskTemplate[]>([]);

async function loadTemplates(): Promise<void> {
  try {
    const result = await processApi.listTemplates();
    templates.value = result.items;
  } catch (e) {
    notifyApiError(e, '任务模板加载失败');
  }
}

/** 点击模板按钮 → 启动其绑定的白名单任务 */
async function runTemplate(task: ProcessTaskName): Promise<void> {
  await startTask(task);
}

// ── [U3-P3/K6] 历史记录区 ──

/** 历史列表 */
const runItems = ref<TaskRunListItem[]>([]);
/** 历史总数 */
const runTotal = ref(0);
/** 历史分页（页码从 1 起） */
const runPage = ref(1);
/** 历史每页条数 */
const runLimit = 20;
/** 历史加载中 */
const runsLoading = ref(false);
/** 日志全文对话框可见 */
const logDialogVisible = ref(false);
/** 日志全文内容 */
const logText = ref('');
/** 日志对话框标题（任务 + 起始时间） */
const logDialogTitle = ref('');

async function loadRuns(): Promise<void> {
  runsLoading.value = true;
  try {
    const page = await processApi.listRuns(runPage.value, runLimit);
    runItems.value = page.items;
    runTotal.value = page.total;
  } catch (e) {
    notifyApiError(e, '任务历史加载失败');
  } finally {
    runsLoading.value = false;
  }
}

/** 翻页 */
async function changeRunPage(page: number): Promise<void> {
  runPage.value = page;
  await loadRuns();
}

/** 查看全文日志（详情端点才给 log_text） */
async function openLog(row: TaskRunListItem): Promise<void> {
  try {
    const detail = await processApi.getRun(row.id);
    logText.value = detail.logText ?? '（本次运行无日志输出）';
    logDialogTitle.value = `${row.task} · ${formatTime(row.startedAt)}`;
    logDialogVisible.value = true;
  } catch (e) {
    notifyApiError(e, '任务日志加载失败');
  }
}

/** 单条删除（带确认） */
async function removeRun(row: TaskRunListItem): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除该条任务历史？此操作不可恢复。`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch {
    return; // 用户取消
  }
  try {
    await processApi.deleteRun(row.id);
    ElMessage.success('已删除');
    // 删掉当前页最后一条时回退一页
    if (runItems.value.length === 1 && runPage.value > 1) {
      runPage.value -= 1;
    }
    await loadRuns();
  } catch (e) {
    notifyApiError(e, '删除任务历史失败');
  }
}

/** 历史状态标签类型 */
function runStatusType(status: TaskRunListItem['status']): 'success' | 'info' | 'danger' {
  if (status === 'running') return 'success';
  if (status === 'failed') return 'danger';
  return 'info';
}

const RUN_STATUS_LABELS: Record<TaskRunListItem['status'], string> = {
  running: '运行中',
  exited: '成功',
  failed: '失败',
};

/** 耗时（毫秒 → 展示文本） */
function runDuration(row: TaskRunListItem): string {
  if (row.finishedAt === null) {
    return '—';
  }
  const ms = new Date(row.finishedAt).getTime() - new Date(row.startedAt).getTime();
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} 分 ${Math.round((ms % 60_000) / 1000)} 秒`;
}

// ── [U3-P4a/K5] 任务环境变量区（与模板区并列；值按凭据处理，写后不可读） ──

/**
 * 服务端现存的掩码条目（GET 只回 `{ key, masked }`，明文永不返回）。
 * [K3] PUT 是**整表替换**：由于既有值不可读，保持某条变量的唯一办法是在本次会话
 * 重新输入它的值——未重输的既有键会在保存时被移除（保存前二次确认里逐条列出）。
 */
const taskEnvItems = ref<TaskEnvEntry[]>([]);
/** 本次会话输入的值（**唯一**持有明文的前端状态；保存成功后立即清空，不落 localStorage） */
const taskEnvDraft = ref<Record<string, string>>({});
/** 本次保存将移除的既有键（表格「删除」= 打标记，不直接发请求） */
const taskEnvRemoved = ref<string[]>([]);
const taskEnvLoading = ref(false);
const taskEnvSaving = ref(false);
const newEnvKey = ref('');
const newEnvValue = ref('');

/** 表格行（既有条目 + 本次新增；掩码对草稿值同样生效——掩码规则复用 shared 单源） */
interface TaskEnvRow {
  key: string;
  masked: string;
  /** true = 本次会话输入了值（保存后才有明文存在） */
  pending: boolean;
}

const taskEnvRows = computed<TaskEnvRow[]>(() => {
  const rows: TaskEnvRow[] = [];
  const existingKeys = new Set(taskEnvItems.value.map((item) => item.key));
  for (const item of taskEnvItems.value) {
    if (taskEnvRemoved.value.includes(item.key)) {
      continue;
    }
    const draft = taskEnvDraft.value[item.key];
    rows.push({
      key: item.key,
      masked: draft !== undefined ? maskTaskEnvValue(draft) : item.masked,
      pending: draft !== undefined,
    });
  }
  for (const key of Object.keys(taskEnvDraft.value)) {
    if (!existingKeys.has(key) && !taskEnvRemoved.value.includes(key)) {
      rows.push({ key, masked: maskTaskEnvValue(taskEnvDraft.value[key] ?? ''), pending: true });
    }
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key));
});

async function loadTaskEnv(): Promise<void> {
  taskEnvLoading.value = true;
  try {
    const view = await processApi.listTaskEnv();
    taskEnvItems.value = view.items;
    taskEnvDraft.value = {};
    taskEnvRemoved.value = [];
  } catch (e) {
    notifyApiError(e, '任务环境变量加载失败');
  } finally {
    taskEnvLoading.value = false;
  }
}

/** 新增/重输一条：键名统一大写（服务端要求大写形态；前缀白名单由服务端权威校验） */
function addTaskEnv(): void {
  const key = newEnvKey.value.trim().toUpperCase();
  if (key === '') {
    ElMessage.warning('请填写变量名');
    return;
  }
  if (newEnvValue.value === '') {
    ElMessage.warning('请填写变量值');
    return;
  }
  taskEnvDraft.value = { ...taskEnvDraft.value, [key]: newEnvValue.value };
  taskEnvRemoved.value = taskEnvRemoved.value.filter((item) => item !== key);
  newEnvKey.value = '';
  newEnvValue.value = '';
}

/** 删除一行：既有键打移除标记（保存时生效），草稿键直接丢弃 */
function removeTaskEnvRow(row: TaskEnvRow): void {
  const draft = { ...taskEnvDraft.value };
  delete draft[row.key];
  taskEnvDraft.value = draft;
  if (taskEnvItems.value.some((item) => item.key === row.key)) {
    taskEnvRemoved.value = [...taskEnvRemoved.value, row.key];
  }
}

/**
 * 保存整表：提交的 entry 集 = 本次会话输入过值的键（既有值不可读，无法回传未重输的键）。
 * 二次确认里逐条列出将被移除的既有变量——避免「以为只是加一条，结果清掉别的凭据」。
 */
async function saveTaskEnv(): Promise<void> {
  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(taskEnvDraft.value)) {
    if (!taskEnvRemoved.value.includes(key)) {
      entries[key] = value;
    }
  }
  const kept = Object.keys(entries).sort();
  const dropped = taskEnvItems.value
    .map((item) => item.key)
    .filter((key) => !kept.includes(key));
  const dropHint =
    dropped.length > 0
      ? `\n\n以下既有变量未在本次输入新值，保存后将被移除：${dropped.join('、')}`
      : '';
  const confirmed = await ElMessageBox.confirm(
    `将整表保存 ${kept.length} 条任务环境变量，对所有白名单任务（install / dev / build / preview）的子进程生效。\n保存后值不可再查看。${dropHint}`,
    '任务环境变量保存确认',
    { type: 'warning', confirmButtonText: '确认保存', cancelButtonText: '取消' },
  )
    .then(() => true)
    .catch(() => false);
  if (!confirmed) {
    return;
  }
  taskEnvSaving.value = true;
  try {
    const view = await processApi.putTaskEnv(entries);
    taskEnvItems.value = view.items;
    taskEnvDraft.value = {};
    taskEnvRemoved.value = [];
    ElMessage.success('任务环境变量已保存（值不可再查看）');
  } catch (e) {
    notifyApiError(e, '保存任务环境变量失败');
  } finally {
    taskEnvSaving.value = false;
  }
}

onMounted(() => {
  void loadTemplates();
  void loadRuns();
  void loadTaskEnv();
});

</script>

<template>
  <el-card class="console-card">
    <template #header>
      <div class="card-header">
        <span class="page-title">构建与运行控制台</span>
        <span class="page-subtitle">执行构建任务与查看实时日志输出</span>
      </div>
    </template>

    <div class="task-bar">
      <el-button
        v-for="opt in TASK_OPTIONS"
        :key="opt.value"
        :type="currentTask?.task === opt.value ? 'primary' : 'default'"
        :class="{ 'btn-gradient-primary': currentTask?.task === opt.value }"
        :loading="starting"
        :disabled="currentTask?.status === 'running' && currentTask.task !== opt.value"
        @click="startTask(opt.value)"
      >{{ opt.label }}</el-button>
      <el-button :loading="previewOpening" @click="openPreview">站点预览</el-button>
      <el-button
        v-if="currentTask !== null"
        type="danger"
        :disabled="currentTask.status !== 'running'"
        @click="stopTask"
      >停止</el-button>
    </div>

    <div v-if="currentTask !== null" class="task-status">
      <span>任务：{{ currentTask.task }}</span>
      <el-tag :type="STATUS_TYPES[currentTask.status] ?? 'info'">
        {{ STATUS_LABELS[currentTask.status] ?? currentTask.status }}
      </el-tag>
      <span v-if="currentTask.exitCode !== null">exitCode: {{ currentTask.exitCode }}</span>
      <span>启动：{{ formatTime(currentTask.startedAt) }}</span>
    </div>

    <LogTerminal v-if="currentTask !== null" :task-id="currentTask.id" @finished="onFinished" />

    <el-divider content-position="left">端口检测</el-divider>
    <div class="port-bar">
      <el-input v-model="portInput" placeholder="端口号" class="port-input" @keyup.enter="checkPort" />
      <el-button :loading="portChecking" @click="checkPort">检测</el-button>
      <span v-if="portResult !== null" class="port-result">
        端口 {{ portResult.port }}：{{ portResult.inUse ? '占用' : '空闲' }}
      </span>
    </div>

    <!-- [U3-P3/K6] 模板区：白名单任务命名预设（空数组不显示该区） -->
    <el-divider v-if="templates.length > 0" content-position="left">任务模板</el-divider>
    <div v-if="templates.length > 0" class="template-bar">
      <el-tooltip
        v-for="tpl in templates"
        :key="tpl.name"
        :content="tpl.description ?? `执行 ${tpl.task}`"
        placement="top"
      >
        <el-button :loading="starting" @click="runTemplate(tpl.task)">{{ tpl.name }}</el-button>
      </el-tooltip>
    </div>

    <!-- [U3-P4a/K5] 任务环境变量区（与模板区并列；值与凭据同级，写后不可读） -->
    <el-divider content-position="left">任务环境变量</el-divider>
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="注入所有白名单任务的子进程（install / dev / build / preview）"
      description="值按凭据处理：保存后只显示掩码，明文不可再查看。保存为整表替换——既有变量若未在本次输入新值将被移除（保存前会二次确认并列出）。变量名仅允许 BILI_ / ANIME_ / ENABLE_ / CONTENT_ 前缀且须大写；PATH / HOME / APPDATA / CI 由服务固定管理，不允许覆盖。"
      class="env-alert"
    />
    <div v-loading="taskEnvLoading" class="env-panel">
      <el-table v-if="taskEnvRows.length > 0" :data="taskEnvRows" size="small" border class="env-table">
        <el-table-column label="变量名" prop="key" />
        <el-table-column label="值（掩码）" width="220">
          <template #default="{ row }">
            <span class="env-masked">{{ row.masked }}</span>
            <el-tag v-if="row.pending" size="small" type="success">待保存</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button size="small" type="danger" @click="removeTaskEnvRow(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <p v-else class="env-empty">
        尚未配置任务环境变量（子进程仅透传 PATH / HOME / APPDATA，并恒写 CI=true）。
      </p>
      <div class="env-add-bar">
        <el-input
          v-model="newEnvKey"
          placeholder="变量名（如 BILI_SESSDATA）"
          class="env-key-input"
          aria-label="环境变量名"
        />
        <el-input
          v-model="newEnvValue"
          type="password"
          show-password
          placeholder="变量值（保存后不可再查看）"
          class="env-value-input"
          aria-label="环境变量值"
        />
        <el-button @click="addTaskEnv">新增变量</el-button>
        <el-button
          type="primary"
          class="btn-gradient-primary"
          :loading="taskEnvSaving"
          @click="saveTaskEnv"
        >保存整表</el-button>
      </div>
    </div>

    <!-- [U3-P3/K6] 历史记录区 -->
    <el-divider content-position="left">历史记录</el-divider>
    <el-table v-loading="runsLoading" :data="runItems" size="small" border class="run-table">
      <el-table-column label="任务" prop="task" width="110" />
      <el-table-column label="开始时间" width="180">
        <template #default="{ row }">{{ formatTime(row.startedAt) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="runStatusType(row.status)" size="small">
            {{ RUN_STATUS_LABELS[row.status as TaskRunListItem['status']] ?? row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="退出码" width="80">
        <template #default="{ row }">{{ row.exitCode ?? '—' }}</template>
      </el-table-column>
      <el-table-column label="耗时" width="120">
        <template #default="{ row }">{{ runDuration(row) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="180">
        <template #default="{ row }">
          <el-button size="small" @click="openLog(row)">查看日志</el-button>
          <el-button size="small" type="danger" @click="removeRun(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-if="runTotal > runLimit"
      layout="prev, pager, next, total"
      :total="runTotal"
      :page-size="runLimit"
      :current-page="runPage"
      class="run-pagination"
      @current-change="changeRunPage"
    />
  </el-card>

  <!-- [U3-P3/K6] 日志全文对话框（纯文本展示，禁 v-html） -->
  <el-dialog
    v-model="logDialogVisible"
    v-dialog-resize
    draggable
    title="任务日志全文"
    width="720px"
  >
    <p class="log-dialog-title">{{ logDialogTitle }}</p>
    <pre class="log-dialog-text">{{ logText }}</pre>
  </el-dialog>
</template>

<style scoped>
.card-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.page-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}
.page-subtitle {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.task-bar {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.task-status {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.port-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}
.port-input {
  width: 180px;
}
.port-result {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
/* [U3-P3/K6] 模板区 / 历史区 */
.template-bar {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
/* [U3-P4a/K5] 任务环境变量区（间距/字体沿用既有 token，无新增色值） */
.env-alert {
  margin-bottom: 12px;
  border-radius: var(--mizuki-radius-control);
}
.env-panel {
  margin-bottom: 8px;
}
.env-table {
  width: 100%;
  margin-bottom: 10px;
}
.env-masked {
  font-family: var(--el-font-family-monospace, monospace);
  margin-right: 6px;
}
.env-empty {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.env-add-bar {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}
.env-key-input {
  width: 260px;
}
.env-value-input {
  width: 320px;
}
.run-table {
  width: 100%;
}
.run-pagination {
  margin-top: 12px;
  justify-content: flex-end;
}
.log-dialog-title {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.log-dialog-text {
  margin: 0;
  max-height: 60vh;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: var(--el-font-family-monospace, monospace);
  font-size: 12px;
  line-height: 1.6;
  background: var(--el-fill-color-extra-light);
  border: 1px solid var(--mizuki-border-hairline);
  border-radius: var(--mizuki-radius-control);
  padding: 10px 12px;
}
</style>
