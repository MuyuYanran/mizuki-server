<script setup lang="ts">
/**
 * [P10d] 日志终端组件（构建预览控制台 SSE 日志）
 * [职责] 订阅 /admin/process/tasks/:id/logs SSE 流，渲染日志行；
 *   stderr/error 行标红样式；纯文本渲染（禁 v-html，§5 专属禁止）；
 *   自动滚动到底；组件卸载时退订避免泄漏。
 * [状态] ACTIVE
 *
 * SSE 经 fetch + ReadableStream 消费（EventSource 无法带 token，见 process.ts）。
 */
import { onBeforeUnmount, ref, watch } from 'vue';
import { streamTaskLogs, type LogEvent } from '../api/process';

const props = defineProps<{
  taskId: string;
}>();

const emit = defineEmits<{
  (e: 'finished', exitCode: number): void;
}>();

interface LogLine {
  text: string;
  stderr: boolean;
}

const lines = ref<LogLine[]>([]);
const containerRef = ref<HTMLDivElement | null>(null);

let detach: (() => void) | null = null;

function onEvent(event: LogEvent): void {
  if (event.type === 'log') {
    const stderr = event.line.startsWith('[stderr]') || event.line.startsWith('[error]');
    lines.value.push({ text: event.line, stderr });
  } else {
    lines.value.push({ text: `— 任务退出（exitCode: ${event.exitCode}）—`, stderr: false });
    emit('finished', event.exitCode);
  }
  scrollToBottom();
}

function scrollToBottom(): void {
  // DOM 更新后滚动到底（requestAnimationFrame 确保渲染完成）
  requestAnimationFrame(() => {
    const el = containerRef.value;
    if (el !== null) {
      el.scrollTop = el.scrollHeight;
    }
  });
}

function start(): void {
  detach?.();
  lines.value = [];
  detach = streamTaskLogs(props.taskId, {
    onEvent,
    onComplete: () => {
      // 流自然结束（exit 事件后或服务端关闭）；detach 在卸载时清理
    },
    onError: (error) => {
      const msg = error instanceof Error ? error.message : 'SSE 连接失败';
      lines.value.push({ text: `[error] ${msg}`, stderr: true });
    },
  });
}

watch(
  () => props.taskId,
  (id) => {
    if (id !== '') {
      start();
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  detach?.();
  detach = null;
});
</script>

<template>
  <div ref="containerRef" class="log-terminal">
    <div v-for="(line, i) in lines" :key="i" :class="['log-line', { stderr: line.stderr }]">
      {{ line.text }}
    </div>
    <div v-if="lines.length === 0" class="empty-hint">等待日志输出…</div>
  </div>
</template>

<style scoped>
.log-terminal {
  height: 400px;
  overflow-y: auto;
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  padding: 8px;
  border-radius: 4px;
}
.log-line {
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.5;
}
.log-line.stderr {
  color: #f48771;
}
.empty-hint {
  color: #888;
  font-style: italic;
}
</style>
