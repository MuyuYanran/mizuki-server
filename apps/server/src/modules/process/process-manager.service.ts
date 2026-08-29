/**
 * [阶段 P9] process/process-manager.service — 白名单子进程管理
 * [职责] 任务白名单（install/dev/build/preview 硬编码，禁止命令拼接）→
 *   确定性解析链（C3/ADR-011：pm-resolver 产出「执行计划」file+args 前缀，垫片穿透直跑，
 *   lockfile 探测维持 P9 既有实现）→ cross-spawn `shell:false` 子进程（env 仅透传
 *   PATH/HOME/APPDATA；POSIX detached 进程组）→ 内存环形缓冲日志（2000 行，stdout/stderr
 *   合并，stderr 标源）→ SSE 订阅分发 → tree-kill 停整组 → process.finished 事件。
 * [状态] ACTIVE
 *
 * 安全（MASTER-PLAN §7 / REQUIREMENTS §9.4）：不接受任何用户附加参数；
 * 工作目录锁定 mizukiRoot（safeJoin）；shell 恒为 false（解析链亦然，见 pm-resolver）。
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import spawn from 'cross-spawn';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { nanoid } from 'nanoid';
import treeKill from 'tree-kill';
import { z } from 'zod';
import { EVENTS, ProcessFinishedPayload } from '@mizuki/shared';
import { logger } from '../../common/logger';
import { ForbiddenPathError, safeJoin } from '../../common/security/safe-join';
import { type BackupOptions, BACKUP_OPTIONS } from '../../infra/backup/backup.service';
import { PackageManagerResolver, type ResolverOptions, type SpawnPlan } from './pm-resolver';

// ── zod schema（全部输入边界） ──

/** 任务白名单（逐字硬编码，MASTER-PLAN §7） */
export const TASK_WHITELIST = ['install', 'dev', 'build', 'preview'] as const;
export type ProcessTaskName = (typeof TASK_WHITELIST)[number];

/** POST /admin/process/tasks body：白名单外一切拒绝（含注入串）→ 400 */
export const StartTaskBodySchema = z.object({
  task: z.enum(TASK_WHITELIST),
});

/** :id 参数（nanoid 字符集） */
export const ProcessTaskIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

/** :port 参数（1–65535） */
export const PortParamSchema = z.string().regex(/^\d{1,5}$/).refine((value) => {
  const parsed = Number(value);
  return parsed >= 1 && parsed <= 65535;
}, 'port 必须在 1–65535');

/** 环形缓冲容量（MASTER-PLAN §7） */
const LOG_BUFFER_CAPACITY = 2000;

/** 优雅停机等待退出的超时（P9 §3.4b：5 秒） */
const SHUTDOWN_GRACE_MS = 5000;

export type TaskStatus = 'running' | 'exited' | 'killed';

/** SSE / 订阅者的日志事件（最小约定，细节记报告） */
export type LogEvent = { type: 'log'; line: string } | { type: 'exit'; exitCode: number };

interface LogListener {
  onEvent(event: LogEvent): void;
  onComplete(): void;
}

/** 任务实例（内存态，服务重启不保留） */
interface TaskInstance {
  id: string;
  task: ProcessTaskName;
  pid: number;
  status: TaskStatus;
  exitCode: number | null;
  startedAt: number;
  finishedAt: number | null;
  child: ChildProcess;
  buffer: string[];
  /** stdout/stderr 各自的行半残片 */
  partial: { stdout: string; stderr: string };
  listeners: Set<LogListener>;
  /** DELETE 触发的 kill 标记（区分自然退出与被杀） */
  killRequested: boolean;
}

/** 对外任务视图 */
export interface TaskView {
  id: string;
  task: ProcessTaskName;
  pid: number;
  status: TaskStatus;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
}

/** 端口探测结果 */
export interface PortProbeResult {
  port: number;
  inUse: boolean;
  byCurrentTask?: string;
}

@Injectable()
export class ProcessManagerService implements OnApplicationShutdown {
  private readonly tasks = new Map<string, TaskInstance>();
  private readonly pmResolver = new PackageManagerResolver();
  private shutdownRequested = false;

  constructor(
    private readonly emitter: EventEmitter2,
    @Inject(BACKUP_OPTIONS) private readonly options: BackupOptions,
  ) {}

  // ── 任务生命周期 ──

  /** 启动任务：白名单校验已在路由层（zod）完成，此处先解析链取执行计划再按映射表固定参数执行 */
  async startTask(task: ProcessTaskName): Promise<TaskView> {
    if (this.shutdownRequested) {
      throw new BadRequestException('服务正在停机，拒绝启动新任务');
    }
    const cwd = this.requireMizukiRoot();
    const packageManager = detectPackageManager(cwd);
    const plan = await this.pmResolver.resolve(packageManager, { projectRoot: cwd });
    const args = taskArgs(task, packageManager);
    const child = spawn(plan.file, [...plan.argsPrefix, ...args], buildSpawnOptions(cwd));
    if (child.pid === undefined) {
      throw new BadRequestException(`任务启动失败：${task}（无法获得子进程 pid）`);
    }
    const instance: TaskInstance = {
      id: nanoid(),
      task,
      pid: child.pid,
      status: 'running',
      exitCode: null,
      startedAt: Date.now(),
      finishedAt: null,
      child,
      buffer: [],
      partial: { stdout: '', stderr: '' },
      listeners: new Set(),
      killRequested: false,
    };
    this.tasks.set(instance.id, instance);

    child.stdout?.on('data', (chunk: Buffer) => this.ingest(instance, 'stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => this.ingest(instance, 'stderr', chunk));
    child.on('error', (error) => {
      this.pushLine(instance, `[error] ${error.message}`);
    });
    child.on('exit', (code, signal) => {
      this.finalize(instance, code, signal);
    });

    logger.info(
      {
        id: instance.id,
        task,
        pid: instance.pid,
        packageManager,
        planFile: plan.file,
        planArgsPrefix: plan.argsPrefix,
        planSource: plan.source,
      },
      '任务已启动（解析产物见 plan* 字段，ADR-011 command_snapshot 语义的内存日志承载）',
    );
    return this.toView(instance);
  }

  /** 任务状态 */
  getTask(id: string): TaskView {
    return this.toView(this.getOrThrow(id));
  }

  /** 停止任务：tree-kill 停整组 → status killed（P9 §3.4） */
  async stopTask(id: string): Promise<TaskView> {
    const instance = this.getOrThrow(id);
    if (instance.status === 'running') {
      instance.killRequested = true;
      await treeKillAsync(instance.pid);
      logger.info({ id, task: instance.task, pid: instance.pid }, '任务停止请求已发出（tree-kill）');
    }
    return this.toView(instance);
  }

  /** 环形缓冲快照（诊断用；SSE 回放同源于此缓冲） */
  snapshotLogs(id: string): string[] {
    return [...this.getOrThrow(id).buffer];
  }

  /**
   * SSE 日志订阅：先回放缓冲，再实时推送；任务已终态 → 回放后立即 exit + complete。
   * 返回退订函数（Observable teardown 调用，不得泄漏监听）。
   */
  attachLogListener(id: string, listener: LogListener): () => void {
    const instance = this.getOrThrow(id);
    for (const line of instance.buffer) {
      listener.onEvent({ type: 'log', line });
    }
    if (instance.status !== 'running') {
      listener.onEvent({ type: 'exit', exitCode: instance.exitCode ?? -1 });
      listener.onComplete();
      return () => undefined;
    }
    instance.listeners.add(listener);
    return () => {
      instance.listeners.delete(listener);
    };
  }

  /** 端口占用检测（探测法：尝试绑定，失败即占用，取舍记报告） */
  probePort(port: number): Promise<PortProbeResult> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => {
        logger.info({ port, inUse: true }, '端口检测：占用');
        resolve({ port, inUse: true });
      });
      server.listen(port, () => {
        server.close(() => {
          logger.info({ port, inUse: false }, '端口检测：空闲');
          resolve({ port, inUse: false });
        });
      });
    });
  }

  // ── 优雅停机（P9 §3.4b，经 main.ts enableShutdownHooks 传入信号） ──

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.shutdownRequested = true;
    const running = [...this.tasks.values()].filter((task) => task.status === 'running');
    if (running.length === 0) {
      return;
    }
    logger.info({ signal, count: running.length }, '优雅停机：停止全部运行中任务');

    let forced = 0;
    await Promise.all(
      running.map(async (instance) => {
        instance.killRequested = true;
        await treeKillAsync(instance.pid);
        const exited = await waitFor(() => instance.status !== 'running', SHUTDOWN_GRACE_MS);
        if (!exited) {
          // 超时强杀（POSIX SIGKILL 语义；Windows tree-kill 本身即强制）
          forced += 1;
          await treeKillAsync(instance.pid, 'SIGKILL');
          await waitFor(() => instance.status !== 'running', 2000);
          if (instance.status === 'running') {
            // 仍无退出事件：强制置终态并通知订阅者（进程交由平台回收）
            instance.status = 'killed';
            instance.exitCode = -1;
            instance.finishedAt = Date.now();
            this.notifyListeners(instance, { type: 'exit', exitCode: -1 });
          }
        }
      }),
    );

    // 关闭全部 SSE 连接（终态事件已在 finalize/上方发出，此处完成观察者）
    for (const instance of this.tasks.values()) {
      for (const listener of [...instance.listeners]) {
        listener.onComplete();
        instance.listeners.delete(listener);
      }
    }
    logger.info({ stopped: running.length, forced }, '优雅停机完成');
  }

  // ── 内部实现 ──

  /** 子进程输出采集：按行切分（保留半行），stderr 标源，入环形缓冲并分发 */
  private ingest(instance: TaskInstance, stream: 'stdout' | 'stderr', chunk: Buffer): void {
    const text = instance.partial[stream] + chunk.toString('utf8');
    const lines = text.split(/\r?\n/);
    instance.partial[stream] = lines.pop() ?? '';
    for (const line of lines) {
      this.pushLine(instance, stream === 'stderr' ? `[stderr] ${line}` : line);
    }
  }

  /** 环形缓冲写入（超 2000 行丢最旧）+ 分发监听器 */
  private pushLine(instance: TaskInstance, line: string): void {
    instance.buffer.push(line);
    if (instance.buffer.length > LOG_BUFFER_CAPACITY) {
      instance.buffer.splice(0, instance.buffer.length - LOG_BUFFER_CAPACITY);
    }
    this.notifyListeners(instance, { type: 'log', line });
  }

  private notifyListeners(instance: TaskInstance, event: LogEvent): void {
    for (const listener of instance.listeners) {
      try {
        listener.onEvent(event);
      } catch {
        instance.listeners.delete(listener); // 订阅侧异常 → 摘除，不影响任务
      }
    }
  }

  /** 子进程退出收口：状态/退出码/终态分发 + process.finished 事件（恰好一次） */
  private finalize(instance: TaskInstance, code: number | null, signal: NodeJS.Signals | null): void {
    if (instance.status !== 'running') {
      return; // 幂等（退出路径与强杀路径可能竞态）
    }
    // 冲刷残留半行
    for (const stream of ['stdout', 'stderr'] as const) {
      const rest = instance.partial[stream];
      if (rest !== '') {
        this.pushLine(instance, stream === 'stderr' ? `[stderr] ${rest}` : rest);
        instance.partial[stream] = '';
      }
    }
    instance.status = instance.killRequested ? 'killed' : 'exited';
    // 退出码约定（记报告）：有实际退出码用实际值；被信号终止（无码）记 -1
    instance.exitCode = code ?? -1;
    instance.finishedAt = Date.now();

    this.notifyListeners(instance, { type: 'exit', exitCode: instance.exitCode });
    for (const listener of [...instance.listeners]) {
      listener.onComplete();
      instance.listeners.delete(listener);
    }

    const payload = ProcessFinishedPayload.parse({
      task: instance.task,
      exitCode: instance.exitCode,
      durationMs: instance.finishedAt - instance.startedAt,
    });
    this.emitter.emit(EVENTS.ProcessFinished, payload);
    logger.info(
      { id: instance.id, task: instance.task, exitCode: instance.exitCode, signal, status: instance.status },
      '任务已退出',
    );
  }

  private getOrThrow(id: string): TaskInstance {
    const instance = this.tasks.get(id);
    if (!instance) {
      throw new NotFoundException(`任务不存在：${id}`);
    }
    return instance;
  }

  /** 工作目录锁定 mizukiRoot（safeJoin 校验；未配置 → 400） */
  private requireMizukiRoot(): string {
    if (this.options.mizukiRoot === '') {
      throw new BadRequestException('Mizuki 项目根目录未配置（请先完成初始化）');
    }
    const root = path.resolve(this.options.mizukiRoot);
    try {
      return safeJoin(root, '.');
    } catch (error) {
      if (error instanceof ForbiddenPathError) {
        throw new BadRequestException('Mizuki 项目根目录非法');
      }
      throw error;
    }
  }

  private toView(instance: TaskInstance): TaskView {
    return {
      id: instance.id,
      task: instance.task,
      pid: instance.pid,
      status: instance.status,
      exitCode: instance.exitCode,
      startedAt: new Date(instance.startedAt).toISOString(),
      finishedAt: instance.finishedAt === null ? null : new Date(instance.finishedAt).toISOString(),
    };
  }
}

// ── 纯工具（导出供单测断言：shell:false 与 env 白名单，P9 §6.7） ──

/** 包管理器探测（lockfile，沿用 P6 detector 口径；均无 → 默认 npm） */
export function detectPackageManager(cwd: string): 'pnpm' | 'yarn' | 'npm' {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) {
    return 'yarn';
  }
  return 'npm';
}

/**
 * 层②编排（C3/ADR-011）：lockfile 探测（上方 P9 既有实现，不重写）→ 解析链执行计划。
 * 独立导出供单测（层②集成断言）与 startTask 复用；resolver 置于本侧避免循环导入。
 */
export async function resolveProjectSpawnPlan(
  cwd: string,
  resolver: PackageManagerResolver,
  options: Omit<ResolverOptions, 'projectRoot'> = {},
): Promise<SpawnPlan> {
  const packageManager = detectPackageManager(cwd);
  return resolver.resolve(packageManager, { ...options, projectRoot: cwd });
}

/** 任务 → 参数映射（逐字固定，不接受用户附加参数；yarn install 无参，取舍记报告） */
export function taskArgs(task: ProcessTaskName, packageManager: 'pnpm' | 'yarn' | 'npm'): string[] {
  if (task === 'install') {
    return packageManager === 'yarn' ? [] : ['install'];
  }
  return ['run', task];
}

/** env 仅透传 PATH / HOME / APPDATA（MASTER-PLAN §7） */
export function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const passthrough = ['PATH', 'HOME', 'APPDATA'] as const;
  for (const key of passthrough) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

/** spawn 选项（shell 恒 false；POSIX detached 进程组，Windows 按平台行为，取舍记报告） */
export function buildSpawnOptions(cwd: string): SpawnOptions {
  return {
    cwd,
    env: childEnv(),
    detached: process.platform !== 'win32',
    shell: false,
  };
}

/** tree-kill Promise 包装 */
function treeKillAsync(pid: number, signal?: string): Promise<void> {
  return new Promise((resolve) => {
    if (signal !== undefined) {
      treeKill(pid, signal, () => resolve());
    } else {
      treeKill(pid, () => resolve());
    }
  });
}

/** 轮询等待条件成立（超时返回 false） */
async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}
