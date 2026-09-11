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
 * [状态] ACTIVE
 *
 * SSE 经 fetch 流携带 Bearer token（process.ts）；LogTerminal 在 exit 事件后
 * emit 'finished'，本页据以刷新任务终态。
 */
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { processApi, type ProcessTaskName, type TaskView, type PortProbeResult } from '../../api/process';
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


</script>

<template>
  <el-card>
    <template #header><span>构建预览控制台</span></template>

    <div class="task-bar">
      <el-button
        v-for="opt in TASK_OPTIONS"
        :key="opt.value"
        :type="currentTask?.task === opt.value ? 'primary' : 'default'"
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
  </el-card>
</template>

<style scoped>
.task-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.task-status {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.port-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.port-input {
  width: 160px;
}
.port-result {
  color: var(--el-text-color-secondary);
}
</style>
