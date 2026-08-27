<script setup lang="ts">
/**
 * [P10d] 日志终端组件（构建预览控制台 SSE 日志）
 * [职责] 订阅 /admin/process/tasks/:id/logs SSE 流，渲染日志行；
 *   stderr/error 行标红样式；纯文本渲染（禁 v-html，§5 专属禁止）；
 *   自动滚动到底；组件卸载时退订避免泄漏。
 * [状态] ACTIVE
 *
 * SSE 经 fetch + ReadableStream 消费（EventSource 无法带 token，见 process.ts）。
 *
 * [Phase2-B1 / R2-1] 终端观感全部走 CSS 变量（--mizuki-terminal-*，见
 * styles/theme.css）：暗色底 #0d1117 基调、明暗两态前景、滚动条样式、
 * 日志分级着色——stdout 默认灰白 / stderr 淡红 / exit 事件高亮
 * （exitCode≠0 按错误色加重）。
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
  level: 'stdout' | 'stderr' | 'exit';
  /** exit 行的退出码（着色依据：0 成功 / 非 0 失败） */
  exitCode?: number;
}

const lines = ref<LogLine[]>([]);
const containerRef = ref<HTMLDivElement | null>(null);

let detach: (() => void) | null = null;

function onEvent(event: LogEvent): void {
  if (event.type === 'log') {
    const stderr = event.line.startsWith('[stderr]') || event.line.startsWith('[error]');
    lines.value.push({ text: event.line, level: stderr ? 'stderr' : 'stdout' });
  } else {
    lines.value.push({
      text: `— 任务退出（exitCode: ${event.exitCode}）—`,
      level: 'exit',
      exitCode: event.exitCode,
    });
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
      lines.value.push({ text: `[error] ${msg}`, level: 'stderr' });
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
    <div
      v-for="(line, i) in lines"
      :key="i"
      :class="[
        'log-line',
        `log-${line.level}`,
        { 'log-exit-failed': line.level === 'exit' && (line.exitCode ?? 0) !== 0 },
      ]"
    >
      {{ line.text }}
    </div>
    <div v-if="lines.length === 0" class="empty-hint">等待日志输出…</div>
  </div>
</template>

<style scoped>
.log-terminal {
  height: 400px;
  overflow-y: auto;
  background: var(--mizuki-terminal-bg);
  color: var(--mizuki-terminal-fg);
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid var(--el-border-color-lighter);
}
/* 滚动条走主题变量（webkit + firefox 两套） */
.log-terminal::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.log-terminal::-webkit-scrollbar-thumb {
  background: var(--mizuki-terminal-scrollbar);
  border-radius: 4px;
}
.log-terminal::-webkit-scrollbar-track {
  background: transparent;
}
.log-terminal {
  scrollbar-width: thin;
  scrollbar-color: var(--mizuki-terminal-scrollbar) transparent;
}
.log-line {
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.5;
}
/* 分级着色（R2-1）：stdout 灰白 / stderr 淡红 / exit 高亮 */
.log-stdout {
  color: var(--mizuki-terminal-stdout);
}
.log-stderr {
  color: var(--mizuki-terminal-stderr);
}
.log-exit {
  color: var(--mizuki-terminal-exit);
  font-weight: 600;
  margin-top: 4px;
}
.log-exit-failed {
  color: var(--mizuki-terminal-stderr);
}
.empty-hint {
  color: var(--mizuki-terminal-hint);
  font-style: italic;
}
</style>
