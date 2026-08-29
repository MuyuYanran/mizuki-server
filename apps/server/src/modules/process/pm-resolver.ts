/**
 * [阶段 C3] process/pm-resolver — 包管理器确定性解析链（R2-16 / ADR-011 落地）
 * [职责] 四层解析链（ADR-011 决策①~④ + 层①显式配置，冲突处以 ADR-011 为准）：
 *   层① 用户显式路径（注入映射 > env MIZUKI_PM_<NAME>_PATH，resolve 期活读）——
 *        已配置且探活失败 → 快速失败（不降级层②③④，显式配置错误必须让用户知道）；
 *   层② lockfile 类型探测（复用 P9 既有 detectPackageManager，见 process-manager.service
 *        的 resolveProjectSpawnPlan 编排）；
 *   层③ 真实二进制定位：目标项目 node_modules/.bin/<cmd> 优先 → where.exe/which -a
 *        全候选兜底，逐候选探活（探活与任务 spawn 完全同一执行计划，C2a bmp 教训）：
 *        · .cmd/.bat → 垫片文本解析提取 .cjs/.js 入口，改写为 process.execPath + 入口直跑
 *          （ADR-011 决策③；解析失败 → 跳过该候选，绝不字符串拼接 shell）；
 *        · 其余（.exe/.com/POSIX 可执行）→ 直接 spawn ['--version']（shell:false）；
 *        · 探活判据 = 退出码 0（输出不解析）；超时（默认 5s）杀进程；失败跳下一候选；
 *   层④ 全失败 → 抛含四层尝试摘要 + 配置指引的 BadRequestException（既有错误通道）。
 * [安全] 全程 shell:false（垫片穿透后为 node 直跑 .js 入口，无 shell 层、无命令拼接面）。
 * [状态] ACTIVE
 */
import fs from 'node:fs';
import path from 'node:path';
import { BadRequestException } from '@nestjs/common';
import spawn from 'cross-spawn';
import { childEnv } from './process-manager.service';

/** 包管理器白名单（层① env 命名域；detectPackageManager 仅产前三者，bun 经显式配置可达） */
export type PmName = 'npm' | 'pnpm' | 'yarn' | 'bun';

/** 层① env 变量名（空串 = 未配置） */
export function pmEnvVarName(name: PmName): string {
  return `MIZUKI_PM_${name.toUpperCase()}_PATH`;
}

/** 解析产物：任务 spawn 的执行计划（探活与任务执行共用，probe/spawn 一致性） */
export interface SpawnPlan {
  /** 最终执行体（node 本体或真实二进制绝对路径） */
  file: string;
  /** 参数前缀（垫片穿透时为 [入口 js 绝对路径]，其余为 []） */
  argsPrefix: string[];
  /** 命中来源（诊断/快照用）：explicit-inject | explicit-env | node_modules/.bin | where | which */
  source: string;
  /** 采用的包管理器名 */
  manager: PmName;
}

export interface ResolverOptions {
  /** 注入 PATH（层③定位器与候选扫描环境；undefined → 活读 process.env.PATH，测试替身） */
  pathEnv?: string;
  /** 层① 注入映射（env 的测试替身；注入映射 > env） */
  explicitPaths?: Partial<Record<PmName, string>>;
  /** 探活超时 ms（默认 5000；测试可缩短注入） */
  probeTimeoutMs?: number;
  /** 项目根（层③ node_modules/.bin 候选来源） */
  projectRoot?: string;
}

interface ProbeResult {
  ok: boolean;
  detail: string;
}

interface Candidate {
  path: string;
  source: string;
}

/** 探活输出摘要截断（不解析，仅入错误/诊断摘要） */
const PROBE_DETAIL_LIMIT = 200;

export class PackageManagerResolver {
  /**
   * 记忆化（提示词两案选其一：缓存键方案）——键 = name + 生效 pathEnv（活读）+
   * 注入映射 + projectRoot，任一变化即失配重解析；探活失败不缓存（异常路径不写 memo），
   * 跨用例无脏缓存。
   */
  private readonly memo = new Map<string, SpawnPlan>();

  /** 解析单个包管理器的执行计划（层①③④） */
  async resolve(name: PmName, options: ResolverOptions = {}): Promise<SpawnPlan> {
    const effectivePathEnv = options.pathEnv ?? process.env['PATH'] ?? '';
    const envValue = process.env[pmEnvVarName(name)] ?? '';
    const explicitKey = JSON.stringify(options.explicitPaths ?? {}, Object.keys(options.explicitPaths ?? {}).sort());
    // 键必须含层① env 值：env 变更（如用户运行期改配置）即失配重解析
    const key = [name, envValue, effectivePathEnv, explicitKey, options.projectRoot ?? ''].join('\u0000');
    const cached = this.memo.get(key);
    if (cached) {
      return cached;
    }
    const plan = await this.resolveUncached(name, options, effectivePathEnv);
    this.memo.set(key, plan);
    return plan;
  }

  private async resolveUncached(
    name: PmName,
    options: ResolverOptions,
    effectivePathEnv: string,
  ): Promise<SpawnPlan> {
    // ── 层①：显式配置（注入映射 > env，resolve 期活读，零魔法） ──
    const injected = options.explicitPaths?.[name];
    const envValue = process.env[pmEnvVarName(name)] ?? '';
    const configured = injected !== undefined && injected !== '' ? injected : envValue;
    if (configured !== '') {
      const source = injected !== undefined && injected !== '' ? 'explicit-inject' : 'explicit-env';
      const plan = planForCandidate(configured);
      const probe =
        plan === null
          ? { ok: false, detail: '垫片解析失败（无法从 .cmd/.bat 提取 js 入口）' }
          : await probePlan(plan, options, effectivePathEnv);
      if (plan !== null && probe.ok) {
        return { file: plan.file, argsPrefix: plan.argsPrefix, source, manager: name };
      }
      // 快速失败：显式配置错误必须让用户知道，静默绕过违反最小惊讶原则
      throw new BadRequestException(
        [
          `包管理器 ${name} 的显式路径探活失败：${configured}（${probe.detail}）`,
          `请检查 ${pmEnvVarName(name)} 或显式配置是否指向可正常执行的可执行文件；`,
          '显式配置错误不会自动降级到 PATH 解析（避免静默绕过用户意图）。',
        ].join('\n'),
      );
    }

    // ── 层③：真实二进制定位（层② lockfile 探测在 resolveProjectSpawnPlan 编排） ──
    const attempts: string[] = ['层① 显式路径：未配置'];
    for (const candidate of listCandidates(name, options, effectivePathEnv, attempts)) {
      const plan = planForCandidate(candidate.path);
      if (!plan) {
        attempts.push(`- ${candidate.path} → 垫片解析失败（无法提取 js 入口），跳过`);
        continue;
      }
      const probe = await probePlan(plan, options, effectivePathEnv);
      if (probe.ok) {
        return { file: plan.file, argsPrefix: plan.argsPrefix, source: candidate.source, manager: name };
      }
      attempts.push(`- ${candidate.path} → ${probe.detail}`);
    }
    // ── 层④：全失败，人类可读诊断（ADR-011 决策④，不裸抛 ENOENT） ──
    throw new BadRequestException(
      [
        `包管理器 ${name} 解析失败（四层尝试摘要）：`,
        ...attempts,
        `请在管理配置中指定可执行文件路径（环境变量 ${pmEnvVarName(name)}），`,
        `或确认 ${name} 已正确安装并在 PATH 中（Windows 可先在终端验证 \`where ${name}\`）。`,
      ].join('\n'),
    );
  }
}

/**
 * 层②编排：lockfile 探测（复用 P9 既有 detectPackageManager）+ 层①③④解析。
 * 置于 process-manager.service（避免循环导入），此处仅约定选项透传。
 */

/** 候选清单：项目 node_modules/.bin 优先（ADR-011 决策②）→ 定位器全候选兜底 */
function listCandidates(
  name: PmName,
  options: ResolverOptions,
  effectivePathEnv: string,
  attempts: string[],
): Candidate[] {
  const out: Candidate[] = [];
  if (options.projectRoot) {
    const binDir = path.join(options.projectRoot, 'node_modules', '.bin');
    if (fs.existsSync(binDir)) {
      for (const entry of fs.readdirSync(binDir)) {
        const lower = entry.toLowerCase();
        if (lower === name || lower === `${name}.cmd` || lower === `${name}.bat` || lower === `${name}.exe`) {
          out.push({ path: path.join(binDir, entry), source: 'node_modules/.bin' });
        }
      }
    }
  }
  const isWin = process.platform === 'win32';
  // 定位器用系统二进制绝对路径（System32 / /usr/bin）：其解析不能依赖被注入的 pathEnv，
  // 而其搜索范围由子进程 PATH env 承载注入（测试替身口径）
  const locator = isWin
    ? path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'where.exe')
    : ['/usr/bin/which', '/bin/which'].find((p) => fs.existsSync(p)) ?? 'which';
  const args = isWin ? [name] : ['-a', name];
  const located = spawn.sync(locator, args, {
    shell: false,
    env: withPathEnv(childEnv(), effectivePathEnv),
    encoding: 'utf8',
  });
  if (located.error) {
    const code = (located.error as NodeJS.ErrnoException).code;
    attempts.push(`- 定位器 ${locator} 不可用（${code ?? located.error.message}）`);
    return dedupe(out);
  }
  for (const line of (located.stdout ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== '') {
      out.push({ path: trimmed, source: isWin ? 'where' : 'which' });
    }
  }
  return dedupe(out);
}

/** 去重（where 可能同时给出无扩展名与 .cmd 双形态，指向不同真实体，路径级去重即可） */
function dedupe(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.path.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(candidate);
    }
  }
  return out;
}

/** 候选 → 执行计划；.cmd/.bat 垫片穿透（ADR-011 决策③），解析失败返回 null 跳过 */
function planForCandidate(candidatePath: string): { file: string; argsPrefix: string[] } | null {
  if (process.platform === 'win32') {
    const ext = path.extname(candidatePath).toLowerCase();
    if (ext === '.cmd' || ext === '.bat') {
      const entry = extractShimEntry(candidatePath);
      if (entry === null) {
        return null;
      }
      return { file: process.execPath, argsPrefix: [entry] };
    }
  }
  return { file: candidatePath, argsPrefix: [] };
}

/**
 * 垫片文本解析：取最后一条被引号包裹、以 .cjs/.mjs/.js 结尾的路径（npm cmd-shim 生成格式中
 * 入口恒在末行 CALL 语句），将 %~dp0/%dp0% 还原为垫片所在目录后 resolve。
 * 禁止执行垫片本身（批处理语法脆弱）；入口是否存在由探活验证（dlx 悬空垫片即在此被跳过）。
 */
function extractShimEntry(shimPath: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(shimPath, 'utf8');
  } catch {
    return null;
  }
  const matches = [...text.matchAll(/"([^"\r\n]+\.(?:cjs|mjs|js))"/gi)].map((match) => match[1] ?? '');
  if (matches.length === 0) {
    return null;
  }
  const dir = path.dirname(shimPath);
  const raw = matches[matches.length - 1]!.replace(/%~dp0/gi, dir).replace(/%dp0%/gi, dir);
  return path.resolve(raw);
}

/** 探活：与任务 spawn 完全同一执行计划，['--version']，shell:false，退出码 0 即通过 */
function probePlan(
  plan: { file: string; argsPrefix: string[] },
  options: ResolverOptions,
  effectivePathEnv: string,
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    let detail = '';
    const child = spawn(plan.file, [...plan.argsPrefix, '--version'], {
      shell: false,
      env: withPathEnv(childEnv(), effectivePathEnv),
    });
    const timer = setTimeout(
      () => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill();
        resolve({
          ok: false,
          detail: `探活超时（${options.probeTimeoutMs ?? 5000}ms）已终止${outputSummary(detail)}`,
        });
      },
      options.probeTimeoutMs ?? 5000,
    );
    const finish = (result: ProbeResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      detail += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      detail += chunk.toString('utf8');
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({ ok: false, detail: `spawn 失败：${error.code ?? error.message}` });
    });
    child.on('exit', (code) => {
      finish({
        ok: code === 0,
        detail: code === 0 ? '探活通过（exit 0）' : `退出码 ${code ?? 'null'}${outputSummary(detail)}`,
      });
    });
  });
}

/** 探活输出摘要（不解析，仅诊断展示，截断防刷屏） */
function outputSummary(detail: string): string {
  const trimmed = detail.trim().replace(/\s+/g, ' ');
  if (trimmed === '') {
    return '';
  }
  const cut = trimmed.length > PROBE_DETAIL_LIMIT ? `${trimmed.slice(0, PROBE_DETAIL_LIMIT)}…` : trimmed;
  return `（输出摘要：${cut}）`;
}

/** 探活/定位器环境：受控透传基础上，注入 pathEnv 时覆盖 PATH（测试替身口径）；
 * Windows 补默认 PATHEXT（注入 env 常缺省，缺它 where 不匹配 .cmd/.bat/.exe 候选） */
function withPathEnv(base: Record<string, string>, pathEnv: string): Record<string, string> {
  const env = pathEnv === '' ? base : { ...base, PATH: pathEnv };
  if (process.platform === 'win32' && env['PATHEXT'] === undefined) {
    env['PATHEXT'] = '.COM;.EXE;.BAT;.CMD';
  }
  return env;
}
