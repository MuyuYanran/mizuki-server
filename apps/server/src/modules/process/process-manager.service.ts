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
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  EVENTS,
  ProcessFinishedPayload,
  TASK_WHITELIST,
  taskEnvViewOf,
  type ProcessTaskName,
  type PutTaskEnvBody,
  type TaskEnvView,
} from '@mizuki/shared';
import { toMizukiAbs } from '../../common/fs/mizuki-root';
import { logger } from '../../common/logger';
import {
  getAppConfig,
  mergeAndPersistConfig,
  resetAppConfigCache,
} from '../../config/app-config';
import { type BackupOptions, BACKUP_OPTIONS } from '../../infra/backup/backup.service';
import { composeTaskEnv } from './task-env-keep';
import { type DrizzleDb, DRIZZLE_DB } from '../../infra/db/db.module';
import { taskRun } from '../../infra/db/schema';
import { PackageManagerResolver, type ResolverOptions, type SpawnPlan } from './pm-resolver';
import { truncateLogText } from './log-truncate';

// ── zod schema（全部输入边界） ──

/**
 * [U3-P3/K5] 任务白名单已升格至 packages/shared 单源（L0），
 * 本处保留 re-export 以维持既有 import 兼容（`import { TASK_WHITELIST } from
 * './process-manager.service'` 零改动可用），语义零变化。
 * 升格原因：L0 的 config 层需以 z.enum 引用白名单，而 L0 不得 import L3。
 */
export { TASK_WHITELIST };
export type { ProcessTaskName } from '@mizuki/shared';

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
  /** [U3-P3/K3] 执行计划快照（JSON 文本，与 pino plan* 字段同源）→ task_run.command_snapshot */
  commandSnapshot: string;
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
  /** 保留字段：当前任务表未记录监听端口，故暂无取值（不删除——响应形状冻结） */
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
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
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
      commandSnapshot: JSON.stringify({ file: plan.file, args: [...plan.argsPrefix, ...args] }),
    };
    this.tasks.set(instance.id, instance);

    // [U3-P3/K3] 历史写入：启动即落一行（finished_at/exit_code/log_text 暂空）。
    // best-effort——失败只告警，绝不影响任务启动与既有事件分发。
    await this.insertRunRow(instance);

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

  /**
   * 端口占用检测（探测法：尝试绑定，失败即占用，取舍记报告）。
   * [Wave-2/E6] 修复前把**任何**监听失败都报为占用（EACCES 等权限类错误会
   *   被误读为「端口被占」）。现按错误码区分：EADDRINUSE 才是占用，其余
   *   错误视为占用以保守处理（宁可误报占用也不谎报空闲），但日志带上 code
   *   便于诊断。
   */
  probePort(port: number): Promise<PortProbeResult> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', (error: NodeJS.ErrnoException) => {
        const addressInUse = error.code === 'EADDRINUSE';
        logger.info(
          { port, inUse: true, code: error.code, addressInUse },
          addressInUse ? '端口检测：占用' : '端口检测：监听失败（非 EADDRINUSE，按占用保守处理）',
        );
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

  // ── [U3-P4a/K3] 任务级环境变量（写后不可读） ──

  /**
   * GET /admin/process/task-env 的服务侧实现：掩码视图（按 key 字典序）。
   * 值**永不**离开本进程（K4/I5）：视图只含 `{ key, masked }`。
   */
  listTaskEnv(): TaskEnvView {
    return taskEnvViewOf(getAppConfig().taskEnv);
  }

  /**
   * PUT /admin/process/task-env 的服务侧实现：`keep` 合成后**整表落盘**
   * （`entries` 与 `keep` 均空 = 清空，合法）。
   * [U3-P4c/K-keep] 合成规则见 `./task-env-keep`（entries 优先；keep 含未知键或
   *   与 entries 同键 → 400 语义错误，零写盘）；三条约束仍在管道层 + 合成结果复检。
   * - 写盘走 config 既有原子写单源 `mergeAndPersistConfig`（禁裸 fs.writeFile，AGENTS §4-1），
   *   它只记 `keys`（= 'taskEnv' 这个字面量），不记值；
   * - `resetAppConfigCache()` 使变更随下一次 getAppConfig() 活取生效（P11 坑 5 先例），
   *   子进程与 pm-resolver 探活同一次生效（childEnv 单点）；
   * - 返回与 GET 同形的掩码视图（明文不出本函数）。
   */
  putTaskEnv(body: PutTaskEnvBody): TaskEnvView {
    const merged = composeTaskEnv({
      existing: getAppConfig().taskEnv,
      entries: body.entries,
      keep: body.keep,
    });
    mergeAndPersistConfig({ taskEnv: merged });
    resetAppConfigCache();
    // K4：日志只记条数与保留条数（键名可留，值绝不入日志）
    logger.info(
      { count: Object.keys(merged).length, kept: body.keep?.length ?? 0 },
      'taskEnv 已保存（keep 合成后整表写入）',
    );
    return this.listTaskEnv();
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

    // [U3-P3/K3] 历史更新：写 finished_at / exit_code / log_text。
    // best-effort——失败只告警，绝不影响终态分发与既有事件（已先行发出）。
    void this.updateRunRow(instance);
  }

  /**
   * [U3-P3/K3] 历史写入（启动行）：失败只告警，不影响任务启动。
   * best-effort 是硬要求：DB 异常不得把「启动成功」变成「启动失败」。
   */
  private async insertRunRow(instance: TaskInstance): Promise<void> {
    try {
      await this.db.insert(taskRun).values({
        id: instance.id,
        task: instance.task,
        commandSnapshot: instance.commandSnapshot,
        startedAt: new Date(instance.startedAt),
        finishedAt: null,
        exitCode: null,
        logText: null,
      });
    } catch (error) {
      logger.warn({ id: instance.id, task: instance.task, err: error }, '任务历史写入失败（best-effort，不影响任务）');
    }
  }

  /**
   * [U3-P3/K3] 历史更新（退出行）：写 finished_at / exit_code / log_text。
   * log_text = 环形缓冲全量行 join('\n')，按 UTF-8 字节保尾截断 ≤256KB。
   */
  private async updateRunRow(instance: TaskInstance): Promise<void> {
    try {
      const logText = truncateLogText(instance.buffer.join('\n'));
      await this.db
        .update(taskRun)
        .set({
          finishedAt: instance.finishedAt === null ? null : new Date(instance.finishedAt),
          exitCode: instance.exitCode,
          logText,
        })
        .where(eq(taskRun.id, instance.id));
    } catch (error) {
      logger.warn({ id: instance.id, task: instance.task, err: error }, '任务历史更新失败（best-effort，不影响终态）');
    }
  }

  private getOrThrow(id: string): TaskInstance {
    const instance = this.tasks.get(id);
    if (!instance) {
      throw new NotFoundException(`任务不存在：${id}`);
    }
    return instance;
  }

  /** 工作目录锁定 mizukiRoot（未配置 → 400 / 路径非法 → 400，单源见 common/fs/mizuki-root） */
  private requireMizukiRoot(): string {
    return toMizukiAbs(this.options.mizukiRoot, '.', {
      forbidden: 'bad-request',
      forbiddenMessage: 'Mizuki 项目根目录非法',
    });
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

/**
 * env 仅透传 PATH / HOME / APPDATA（MASTER-PLAN §7），合并配置根级 taskEnv，
 * 并**恒定**注入 CI=true（Phase4-D4 配套1）。
 * [U3-P4a/K2] 注入顺序不可变：透传 → taskEnv → 恒写 CI。
 *   · taskEnv 对**所有**白名单任务一致生效（install/dev/build/preview，配置根级而非模板级）；
 *   · 末位恒写 CI 保证 taskEnv 永远不能覆盖 CI 常量（K1 ② 在 schema 层已拒绝，
 *     此处顺序是第二道保险——即便配置被手工改坏也不会改写 CI）；
 *   · 本函数是 env 的唯一注入点：buildSpawnOptions 与 pm-resolver 探活共用，
 *     故指令链两路自动一致（K2 单点）。
 */
export function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const passthrough = ['PATH', 'HOME', 'APPDATA'] as const;
  for (const key of passthrough) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  // [U3-P4a/K2] 任务级环境变量（活取 getAppConfig()，改配置免重启；值不回显）
  Object.assign(env, getAppConfig().taskEnv);
  // [Phase4-D4 / 配套1] CI=true 为**固定字面量**注入，非宿主 env 透传：
  //   · 目的：包管理器与构建脚本在 CI 模式下关闭交互式提示（pnpm install 询问、
  //     vite build 的 TTY 探测等），避免托管任务在无 TTY 的托管环境挂起。
  //   · 边界：取宿主 env 会破坏「env 仅白名单透传」的泄漏防线（P9 §6.7），
  //     故恒写常量而非透传；宿主是否处于 CI 与托管子进程无关。
  //   · 覆盖：buildSpawnOptions 与 pm-resolver 两处探测均经 childEnv()，单点生效。
  env['CI'] = 'true';
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
