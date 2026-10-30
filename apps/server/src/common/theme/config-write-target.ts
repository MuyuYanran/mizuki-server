/**
 * [T3] common/theme/config-write-target — 「配置写入落点」单源解析（L0 纯只读，零写盘）
 *
 * ① 本文件是 T3（配置写入器）的**落点单源**：写入器不再自己判断「该写哪儿」，只消费本函数返回值。
 *    内容分离的本质 = 内容在**另一个仓**，每次 sync 从内容仓 → 代码仓物化。⇒ **写在代码仓 =
 *    下次 sync 被删**。所以任何写入之前必须先回答：这一档，持久的落点在哪；若不能安全落盘，
 *    原因是什么、下一步该做什么。
 * ② 「写代码仓会被删」的四处实测依据（上游口径，非推测）：
 *    - Shirone `scripts/content/sync.mjs`：`prune` 默认 true，物化时裁剪代码仓内容落点；
 *      git 源每次 sync 走 `checkout --force` + `clean -ffdx`，工作副本里新写的东西一律消失；
 *    - Mizuki 上游 `scripts/sync-content.js:84`：内容目录含 `.git` ⇒ `git reset --hard origin/<branch>`；
 *    - 同文件 `:111-118`：内容仓没有 `overrides/` 时 `fs.rmSync(src/config/overrides)`
 *      ⇒ **代码仓**那份覆盖目录被删（写**内容仓**的 `overrides/` 才是安全的）；
 *    - 同文件 `:15-17`：`ENABLE_CONTENT_SYNC=false` 直接早退 ⇒ overrides 不动 ⇒ 视为「无内容目录」。
 * ③ 本文件**只读、零写盘**：只有 `statSync` / 固定叶子读取；形态判据与 mounts 口径**复用既有
 *    L0 单源**（`theme-adapter.ts` / `content-source.ts`），本文件不重新解析、不另立真源；
 *    **禁止递归遍历**，禁止 mkdir / 写文件。拒绝分支一律给「下一步怎么做」的人话说明；
 *    `message` 里**不含任何绝对路径**（仓规红线 6），`dirAbs` 是绝对路径、**仅供后端内部使用**，
 *    不得进入任何响应体。
 * [失败语义] `root` 为空串或不存在 ⇒ `ok:false, reason:'theme-form-unsupported'`，不抛错。
 * [环境变量] 读 `ENABLE_CONTENT_SYNC` / `CONTENT_DIR` / `CONTENT_REPO_URL`（Mizuki HEAD 上游口径，
 *   `sync-content.js:13-17` + `scripts/load-env.js`），**只读不写**。上游唯一的 `.env` 是
 *   `<主题根>/.env`（**没有 `.env.local`**），且由 `sync-content.js` 无条件读入。
 * ⑥ [env 对齐] 上游是**手写解析**：`split("\n")` 切行、`trim` 后跳空行与 `#`、
 *    `/^([^=]+)=(.*)$/` 取第一个 `=` 前的键、值 `trim` 后 `replace(/^["']|["']$/g, "")`
 *    （只去「各一个」首尾引号，不校验配对）；文件不存在 / 读不了 ⇒ 静默跳过。
 * ⑦ [优先级] 上游是无条件 `process.env[key] = value` ⇒ **`.env` 压过真实环境变量**
 *    （与常规 dotenv 相反，也与 Shirone 侧相反）。本文件照此办理：**文件键优先**。
 *    ⚠ 本实现把「进程 env + 文件」合并成**本地视图**，**绝不写 `process.env`**（常驻服务
 *    零全局副作用）—— 这是唯一刻意的写法偏离，生效值与上游逐字一致。
 * ⑧ [路径口径] `CONTENT_DIR` 是**原样使用**，**不是** `path.join(root, CONTENT_DIR)`。
 *    上游 `sync-content.js:17` 是 `process.env.CONTENT_DIR || path.join(rootDir, "content")`，
 *    随后把它原样交给 `fs.existsSync` / `path.join(CONTENT_DIR, …)` / `git clone` / `cwd`
 *    ——全仓**没有**二次 join（实测 `grep -c "join(rootDir, CONTENT_DIR)"` = 0）。
 *    ⇒ 绝对值原样采用；相对值交给 Node 按调用 CWD 解析，而上游由 pnpm 以主题根为 CWD 调用
 *      ⇒ 等价于 `join(root, value)`。详见 `resolveContentDir` 的注释（含「勿改回」警告）。
 *    ⚠ 曾有一版把绝对值也一律 join，会把合法绝对路径拼成 `<root>\<盘符>:\x` 这类不存在的目录，
 *      于是把**能正常同步**的配置误判成「无内容目录」而拒绝（假拒绝）。此为已修缺陷，勿复活。
 * [状态] ACTIVE
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  OVERRIDES_DIR_IN_CONTENT,
  SUPPORTED_SCHEMA_VERSION,
  resolveContentSource,
  // [T5b-1] env / 内容目录解析收敛为 L0 单源
  resolveHeadContentDir,
  resolveHeadEnv,
  type HeadEnvReader,
  type InvalidMountEntry,
} from './content-source';
import { ThemeAdapter } from './theme-adapter';

/** 主题形态（与 theme-adapter 三档 + unknown 对齐） */
export type ConfigWriteForm = 'mizuki-legacy' | 'mizuki-head' | 'shirone' | 'unknown';

/** 可写落点形态：写入器按此三者分派文件生成逻辑 */
export type ConfigWriteSink = 'mizuki-legacy-ts-morph' | 'mizuki-head-override' | 'shirone-yaml';

/** 拒绝原因（枚举取值逐字固定，写入器按它给用户提示，不做字符串匹配之外的推断） */
export type ConfigWriteRejectionReason =
  | 'theme-form-unsupported'
  | 'shirone-local-mode'
  | 'content-source-git'
  | 'manifest-unsupported-version'
  | 'mounts-invalid'
  | 'mounts-overlap'
  | 'mizuki-head-content-sync-disabled'
  | 'mizuki-head-no-content-dir'
  | 'mizuki-head-content-dir-is-git'
  /** 内容目录不存在，但 `CONTENT_REPO_URL` 已设置 ⇒ 上游会把它 git clone 成工作副本 */
  | 'mizuki-head-content-repo-url';

/** 可写分支：这一档的持久落点已确定 */
export interface ConfigWriteTargetOk {
  ok: true;
  form: ConfigWriteForm;
  sink: ConfigWriteSink;
  /** 绝对路径，**仅供后端内部使用**（仓规红线 6）：不得进入任何响应体 */
  dirAbs: string;
  /** 写入后是否必须触发一次内容同步才生效（落点在内容仓时恒为 true） */
  needsSync: boolean;
  /** 本档可写配置域名单（来自 theme-adapter 能力画像，本文件不另立真源；legacy/unknown 为空） */
  domains: readonly string[];
}

/** 拒绝分支：不能安全落盘，附下一步说明 */
export interface ConfigWriteTargetRejected {
  ok: false;
  form: ConfigWriteForm;
  reason: ConfigWriteRejectionReason;
  /** 人话说明**下一步怎么做**；不含任何绝对路径 */
  message: string;
  /** `mounts-invalid` / `mounts-overlap` 时的相对键清单（其余拒绝为空数组；只含相对口径） */
  invalidMounts: readonly string[];
}

export type ConfigWriteTargetResolution = ConfigWriteTargetOk | ConfigWriteTargetRejected;

/** 目录判定（不存在 / 权限不足 → false，不抛） */
function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** 存在性判定（文件或目录均可：`.git` 在工作树里可能是目录，在 linked worktree 里是文件） */
function exists(target: string): boolean {
  try {
    fs.statSync(target);
    return true;
  } catch {
    return false;
  }
}

function reject(
  form: ConfigWriteForm,
  reason: ConfigWriteRejectionReason,
  message: string,
  invalidMounts: readonly string[] = [],
): ConfigWriteTargetRejected {
  return { ok: false, form, reason, message, invalidMounts };
}

/**
 * 生效环境读取器 —— **[T5b-1] 已收敛为 L0 单源**（`content-source.ts` 的 `resolveHeadEnv`）。
 *
 * 上游 `load-env.js` 把 `.env` 无条件灌进 `process.env` ⇒ **文件键压过进程 env**；
 * 本实现只构造只读视图，**不写 `process.env`**。语义与上游逐字一致。
 * 原先本文件内联了 `readRootEnvFile` + `makeEnvReader`，与 `posts-write-target.ts` 各存一份
 * （ADR-028 §22.5 记为「刻意的不收敛」）；T5b-1 收敛后 config / posts / series / moments
 * 四条线共用同一实现，分叉隐患消除。
 */
function makeEnvReader(root: string): HeadEnvReader {
  return resolveHeadEnv(root);
}

/**
 * 内容目录解析（上游 `sync-content.js:17` 口径：**`CONTENT_DIR` 原样使用**）。
 *
 * 上游是 `const CONTENT_DIR = process.env.CONTENT_DIR || path.join(rootDir, "content")`，
 * 之后把它**原样**用在 `fs.existsSync(CONTENT_DIR)`（:32）、`path.join(CONTENT_DIR, mapping.src)`
 * （:107）、`git clone … {CONTENT_DIR}`（:46）、`cwd: CONTENT_DIR`（:65/71/174/181）。
 * 全仓**没有**二次 `join(rootDir, CONTENT_DIR)`（实测 `grep -c` = 0）。
 * ⇒ 绝对值**原样**使用；相对值交给 Node 按进程 CWD 解析，而上游脚本由 pnpm 以主题根为 CWD
 *   调用 ⇒ 等价于 `join(root, value)`。
 *
 * **[勿改回「一律 `join(root, value)`」]** 那会把合法的绝对 `CONTENT_DIR` 拼成
 * `<root>/<盘符>:/x` 这类不存在的目录，于是把能正常同步的配置**误判成「无内容目录」而拒绝**
 * ——正是「Kova 判定的内容目录与上游实际读取的目录劈叉」那种错。
 * 反之，绝对值不存在时上游 `fs.existsSync` 为假 ⇒ 早退不 sync ⇒ 本文件照旧拒绝（诚实）。
 *
 * [T5b-1] 实现已收敛为 L0 单源（`content-source.ts` 的 `resolveHeadContentDir`）。
 */
function resolveContentDir(root: string, readEnv: HeadEnvReader): string {
  return resolveHeadContentDir(root, readEnv);
}

/** mounts 交叉重叠项：上游把冲突键对以 `"A,B"` 形式放进 `invalidMounts`，reason 里带 overlap */
function isOverlapEntry(entry: InvalidMountEntry): boolean {
  return entry.key.includes(',') || /overlap/i.test(entry.reason);
}

/**
 * Mizuki HEAD（overlay-ts）落点：`<内容目录>/overrides/<覆盖名>.ts`。
 * 内容目录是否存在 / 是否含 `.git` / 同步是否启用，决定能否安全落盘（上游 `sync-content.js`）。
 */
function resolveMizukiHeadTarget(
  root: string,
  domains: readonly string[],
): ConfigWriteTargetResolution {
  const readEnv = makeEnvReader(root);

  if (readEnv('ENABLE_CONTENT_SYNC') === 'false') {
    return reject(
      'mizuki-head',
      'mizuki-head-content-sync-disabled',
      '内容同步被关闭（ENABLE_CONTENT_SYNC=false，可能来自主题根的 .env 或环境变量）：上游同步脚本会直接早退，overrides 永远不被物化到主题里。下一步：去掉该环境变量或置为 true，重启本服务后重试。',
    );
  }

  const contentDir = resolveContentDir(root, readEnv);
  if (!isDirectory(contentDir)) {
    const repoUrl = readEnv('CONTENT_REPO_URL');
    if (repoUrl !== undefined && repoUrl !== '') {
      return reject(
        'mizuki-head',
        'mizuki-head-content-repo-url',
        '内容目录不存在，但 CONTENT_REPO_URL 已设置：上游同步脚本会先把内容仓 git clone 到该目录，之后每次同步都对它执行 git reset --hard ⇒ 写进去的覆盖会被丢弃。下一步：让内容仓落到一个不带 .git 的本地目录（例如导出目录），再重试。',
      );
    }
    return reject(
      'mizuki-head',
      'mizuki-head-no-content-dir',
      '未找到内容目录（默认是主题根下的 content/，也可用 CONTENT_DIR 指定）：上游同步脚本会早退并「使用本地内容」，此时写覆盖不会生效。下一步：把内容仓克隆到该目录（或用 CONTENT_DIR 指向它）后重试。',
    );
  }

  if (exists(path.join(contentDir, '.git'))) {
    return reject(
      'mizuki-head',
      'mizuki-head-content-dir-is-git',
      '内容目录是一个 git 工作副本：上游每次同步都会对内容目录执行 git reset --hard，写进去的覆盖会被丢弃。下一步：改成不带 .git 的内容目录（或让内容仓在别处克隆、只把内容目录挂进来）后重试。',
    );
  }

  return {
    ok: true,
    form: 'mizuki-head',
    sink: 'mizuki-head-override',
    dirAbs: path.join(contentDir, OVERRIDES_DIR_IN_CONTENT),
    // 写在内容仓（不是代码仓）⇒ 安全，但要触发一次同步才会物化到主题
    needsSync: true,
    domains,
  };
}

/**
 * Shirone（overlay-yaml）落点：`<内容目录>/config/<域>.yaml`。
 * 全部拒绝条件直接取自 `resolveContentSource` 的返回值（**不重新解析清单**）。
 */
function resolveShironeTarget(root: string, domains: readonly string[]): ConfigWriteTargetResolution {
  const source = resolveContentSource(root);

  if (source.mode === 'local') {
    return reject(
      'shirone',
      'shirone-local-mode',
      '当前主题仓自持内容（未启用内容分离，或清单里没有可用的 source）：此时 config/<域>.yaml 是死文件、改了不生效。下一步：在主题根加 shirone.content.json 并声明内容仓（source.type=path 或 git）后，即可由面板管理配置。',
    );
  }

  if (!source.supported || source.schemaVersion > SUPPORTED_SCHEMA_VERSION) {
    return reject(
      'shirone',
      'manifest-unsupported-version',
      `内容分离清单的结构版本超出本服务支持上限（声明 ${source.schemaVersion}，支持到 ${SUPPORTED_SCHEMA_VERSION}）：不支持的清单版本一律拒绝写入，避免按旧口径写坏内容仓。下一步：升级本服务，或把清单的 schemaVersion 调到支持范围后重试。`,
    );
  }

  if (source.source !== null && source.source.type === 'git') {
    return reject(
      'shirone',
      'content-source-git',
      '内容仓是 git 源：同步脚本每次都会对工作副本 checkout --force + clean -ffdx，写在里面的配置会被清掉。下一步：改用本地目录形态的内容源（清单 source.type 改为 path 并给出目录）后重试。',
    );
  }

  const overlaps = source.invalidMounts.filter(isOverlapEntry);
  if (overlaps.length > 0) {
    return reject(
      'shirone',
      'mounts-overlap',
      '内容分离 mounts 存在交叉重叠的落点：同一份内容会落到两处，同步时可能互相覆盖或被误删。下一步：让各 mounts 的目标目录互不为父子关系，保存后触发一次同步再重试。',
      overlaps.map((entry) => entry.key),
    );
  }

  if (source.invalidMounts.length > 0) {
    return reject(
      'shirone',
      'mounts-invalid',
      '内容分离 mounts 存在非法项（绝对路径、..、保留目录、重复键或非对象）：口径不明，拒绝写入。下一步：按清单规范修正这些挂载键后重试。',
      source.invalidMounts.map((entry) => entry.key),
    );
  }

  return {
    ok: true,
    form: 'shirone',
    sink: 'shirone-yaml',
    dirAbs: source.configDirInContent,
    needsSync: true,
    domains,
  };
}

/**
 * 解析配置写入的持久落点（纯只读、常数级 IO、永不抛错）。
 *
 * @param root 主题 / 项目根目录；空串或不存在 ⇒ `theme-form-unsupported`
 */
export function resolveConfigWriteTarget(root: string): ConfigWriteTargetResolution {
  if (typeof root !== 'string' || root.length === 0 || !isDirectory(root)) {
    return reject(
      'unknown',
      'theme-form-unsupported',
      '主题根缺失或未初始化：无法判断持久落点。下一步：先在设置里指向一个 Mizuki / Shirone 主题目录（含 src/config.ts、src/config/overrideLoader.ts 或 src/config/integrationsConfig.ts 之一）后重试。',
    );
  }

  const profile = new ThemeAdapter().resolve(root);
  const domains = [...profile.capabilities.config.domains];

  switch (profile.capabilities.config.strategy) {
    case 'ts-morph-declaration':
      // mizuki legacy：配置与内容同仓，由既有 ts-morph 路径直接改 `src/config.ts` ⇒ 持久
      return {
        ok: true,
        form: 'mizuki-legacy',
        sink: 'mizuki-legacy-ts-morph',
        dirAbs: path.join(root, profile.layout.configDir),
        needsSync: false,
        domains,
      };

    case 'overlay-ts':
      return resolveMizukiHeadTarget(root, domains);

    case 'overlay-yaml':
      return resolveShironeTarget(root, domains);

    case 'none':
    default:
      return reject(
        'unknown',
        'theme-form-unsupported',
        '无法识别的主题形态（既不是 Mizuki 单文件 / Mizuki HEAD 覆盖形态，也不是 Shirone 源码形态）：不知道该写哪份文件。下一步：确认主题根指向的是源码仓而非 npm 包安装目录（Shirone 包模式当前不支持）后重试。',
      );
  }
}
