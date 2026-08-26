/**
 * [P10d] process 端点客户端（子进程任务与 SSE 日志）
 * [职责] 封装 POST/GET/DELETE /admin/process/tasks、GET /admin/process/ports/:port；
 *   SSE 日志用 fetch + ReadableStream 消费（EventSource 无法带自定义头，
 *   P9 踩坑提醒），纯文本渲染（禁 v-html，§5 专属禁止）。
 * [状态] ACTIVE
 *
 * 后端契约（P9 process.controller，只读引用）：
 * - POST /admin/process/tasks（body { task }）→ TaskView（201）；
 * - GET /admin/process/tasks/:id → TaskView；
 * - DELETE /admin/process/tasks/:id → TaskView（停止）；
 * - GET /admin/process/tasks/:id/logs → SSE（先回放缓冲，再实时推送，终态 exit）；
 * - GET /admin/process/ports/:port → PortProbeResult。
 */
import { API_PREFIX, request } from './http';
import { getAccessToken } from '../stores/auth';

/** 任务白名单（与后端 TASK_WHITELIST 对齐） */
export type ProcessTaskName = 'install' | 'dev' | 'build' | 'preview';

/** 任务状态 */
export type TaskStatus = 'running' | 'exited' | 'killed';

/** 任务视图（与后端 TaskView 对齐） */
export interface TaskView {
  id: string;
  task: ProcessTaskName;
  pid: number;
  status: TaskStatus;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
}

/** 端口探测结果（与后端 PortProbeResult 对齐） */
export interface PortProbeResult {
  port: number;
  inUse: boolean;
  byCurrentTask?: string;
}

/** SSE 日志事件（与后端 LogEvent 对齐） */
export type LogEvent = { type: 'log'; line: string } | { type: 'exit'; exitCode: number };

/** SSE 订阅回调 */
export interface LogStreamCallbacks {
  onEvent(event: LogEvent): void;
  onComplete(): void;
  onError(error: unknown): void;
}

export const processApi = {
  startTask(task: ProcessTaskName): Promise<TaskView> {
    return request<TaskView>('POST', '/admin/process/tasks', { task });
  },

  getTask(id: string): Promise<TaskView> {
    return request<TaskView>('GET', `/admin/process/tasks/${encodeURIComponent(id)}`);
  },

  stopTask(id: string): Promise<TaskView> {
    return request<TaskView>('DELETE', `/admin/process/tasks/${encodeURIComponent(id)}`);
  },

  probePort(port: number): Promise<PortProbeResult> {
    return request<PortProbeResult>('GET', `/admin/process/ports/${port}`);
  },
};

/**
 * SSE 日志流：fetch + ReadableStream 消费 /admin/process/tasks/:id/logs。
 * EventSource 无法带自定义头（P9 踩坑），改用 fetch 流式读取，手动解析 SSE
 * 帧格式（data: <json>\n\n）。返回退订函数（组件卸载时调用，避免泄漏监听）。
 *
 * 注意：SSE 不走 http.ts 的 401 自动 refresh（流式请求语义不同）；
 * 首次 401 → onError 提示重新登录。连接前建议先调 getTask(id) 触发潜在 refresh。
 */
export function streamTaskLogs(taskId: string, callbacks: LogStreamCallbacks): () => void {
  const controller = new AbortController();
  const token = getAccessToken();
  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  fetch(`${API_PREFIX}/admin/process/tasks/${encodeURIComponent(taskId)}/logs`, {
    method: 'GET',
    headers,
    signal: controller.signal,
  })
    .then((res) => {
      if (res.status === 401) {
        callbacks.onError(new Error('认证失效，请重新登录'));
        return;
      }
      if (!res.ok || res.body === null) {
        callbacks.onError(new Error(`SSE 连接失败（${res.status}）`));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      const pump = (): Promise<void> =>
        reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              callbacks.onComplete();
              return;
            }
            const chunk = value ?? new Uint8Array();
            buffer += decoder.decode(chunk, { stream: true });
            let sep: number;
            while ((sep = buffer.indexOf('\n\n')) !== -1) {
              const frame = buffer.slice(0, sep);
              buffer = buffer.slice(sep + 2);
              const dataLine = parseSseFrame(frame);
              if (dataLine !== null) {
                try {
                  const event = JSON.parse(dataLine) as LogEvent;
                  callbacks.onEvent(event);
                  if (event.type === 'exit') {
                    void reader.cancel().then(() => callbacks.onComplete());
                    return;
                  }
                } catch {
                  // 非 JSON 帧（SSE 注释行等）：忽略
                }
              }
            }
            return pump();
          })
          .catch((error: unknown) => {
            if (!controller.signal.aborted) {
              callbacks.onError(error);
            }
          });

      return pump();
    })
    .catch((error: unknown) => {
      if (!controller.signal.aborted) {
        callbacks.onError(error);
      }
    });

  return () => controller.abort();
}

/** 解析单个 SSE 帧，提取 data: 行内容（多行 data 拼接） */
function parseSseFrame(frame: string): string | null {
  const lines = frame.split('\n');
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  return dataLines.length > 0 ? dataLines.join('\n') : null;
}
