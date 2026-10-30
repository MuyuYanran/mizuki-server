/**
 * [T4-3b] common/theme/posts-write-target — 「文章写入是否持久」单源判定（L0 纯只读，零写盘）
 *
 * ① 本文件是 T4-3b 的**安全闸门**：`posts` 模块在**任何写盘之前**消费本函数返回值。
 *    背景见 ADR-028 §14 / §21.7——内容分离（`mode: 'external'`）下，代码仓的
 *    `src/content/posts` 是**物化副本**，写入会在下次 sync 被静默抹掉。在 T4-4（真正的
 *    内容仓路径跟随）落地前，唯一正确的姿势是**拒绝并指路**，而不是让用户写完发现没了。
 *
 * ② **判据按「物化方式」而非「是否 external」** —— 这是本文件唯一但极关键的取舍。
 *    逐行核实两家上游后，`external` 档下 `posts` 的持久性取决于**上游怎么物化它**，
 *    而两家上游的方式**根本不同**：
 *
 *    | 档位 | 上游物化代码 | `posts` 的物化方式 | 写代码仓是否持久 |
 *    |---|---|---|---|
 *    | `mizuki-legacy` | 无内容分离 | —— | ✔ 代码仓即真源 |
 *    | `mizuki-head` | `sync-content.js:96-103` `contentMappings` 里 `posts` **无 `copy: true`** ⇒ `:162` `fs.symlinkSync(relPath, destPath, 'junction')` | **链接**（写穿内容仓） | ✔ 持久 |
 *    | `shirone` | `sync.mjs:153` `copyPreservingMtime` = **`copyFileSync` + `utimesSync`**（全文件零 `symlink`/`linkSync`/`junction`），且 `:69` `prune: !args.has("--no-prune")` ⇒ **prune 默认 true** | **复制 + 裁剪** | ✘ 下次 sync 即消失 |
 *
 *    ⇒ 若按「`mode === 'external'` 一律拒绝」，会把 **Mizuki HEAD 档整档误拒** ——
 *      而该档写代码仓**恰恰是持久的**（写穿 junction 到内容仓）。这是必须避免的假拒绝。
 *
 * ③ 裁剪豁免面三道，**均不覆盖 `src/content/posts/**`**（逐条核实，非推断）：
 *    - `PROTECTED_PATHS`（`resolve-source.mjs:58-62`）只有三条，**全是构建期生成物**：
 *      `public/assets/anime/covers/**`、`public/assets/moments/thumbnails/**`、
 *      `src/assets/fonts/.subset/**`；
 *    - `ownedSegments`（`sync.mjs:338`）= `new Set(sourceFiles.map(topSegment))`，
 *      其中 `topSegment`（`resolve-source.mjs:153`）= **相对路径首段**（根级文件为 `''`）；
 *      而 `collectFiles(sourceAbsolute)` 产出的路径**相对本挂载源根**（无前缀）。
 *      于是挂载 `content → src/content` 时 `ownedSegments ≈ {'posts','spec',...}`；
 *    - `resolved.keep` = 清单 `keep` 白名单（用户显式声明，默认空）。
 *    ⇒ 裁剪循环 `sync.mjs:363-372` 对 `src/content/posts/新增.md` 逐条件全不豁免 ⇒ `rmSync`。
 *      已存在于内容仓的文件虽不被删，但会被 `copyPreservingMtime` **用源覆盖** ⇒ 同样丢写入。
 *
 * ④ **Mizuki HEAD 的两条「不持久」子情形**（junction 不成立时上游自动退化）：
 *    - `ENABLE_CONTENT_SYNC === 'false'` ⇒ `sync-content.js:25-31` 早退，**根本不物化**：
 *      此时代码仓的 `src/content/posts` 是死目录（既不是链接、也不会被刷新）；
 *    - 内容目录不存在且未设 `CONTENT_REPO_URL` ⇒ `:32-42` 打印「将使用本地内容」后
 *      `process.exit(0)`，同样不物化。
 *    另：`symlinkSync` 失败时上游 `:164-166` 会**降级为 `copyRecursive`**。该降级在本文件
 *    **无法静态判定**（需要实际探测 `lstatSync(destPath).isSymbolicLink()`）。本文件**不探** ——
 *    理由：那是盘上运行期状态、随时可被下一次 sync 改写，据它做拒绝判定会给出**不稳定**的答案。
 *    本文件只按上游**声明的物化意图**判定，并在 `notes` 里如实标注这一残留风险。
 *
 * ⑤ 本文件**只读、零写盘**：`statSync` / `lstatSync` / 读固定叶子（`.env`、清单、lock）。
 *    **禁止递归遍历**（大树主题下也常数级 IO）。`contentRoot` / `dirAbs` 是绝对路径、
 *    **仅供后端内部使用**，不得进入任何响应体（仓规红线 6）；`message` 里零绝对路径。
 * ⑥ **永不抛错**：任何探测失败一律退化为「可写」或「拒绝 + 原因」，绝不 500 ——
 *    本函数在写路径最前面，抛错会让**所有**文章操作瘫痪。
 *
 * [状态] ACTIVE
 */
import fs from 'node:fs';
import path from 'node:path';
import { type ThemeProbeEvidence } from '@mizuki/shared';
import {
  type ContentSourceMode,
  resolveContentSource,
  // [T5b-1] Mizuki HEAD 侧 env / 内容目录解析已收敛为 L0 单源（原为本文件内联副本）
  resolveHeadContentDir,
  resolveHeadEnv,
} from './content-source';
// [reuse] 主题形态枚举**不另立真源**：直接复用 T3b-1 的 `ConfigWriteForm`（四档同名同域）
import { type ConfigWriteForm } from './config-write-target';
import { ThemeAdapter } from './theme-adapter';

/**
 * 文章写入的落点持久性结论。
 *
 * - `durable-code-repo`：写代码仓是持久的（legacy 无分离 / HEAD junction 写穿）
 * - `durable-content-repo`：只有写内容仓才持久（**T4-3b 阶段不提供此通道** ⇒ 调用方仍须拒绝）
 * - `ephemeral`：写代码仓会被抹掉，且当前无任何持久落点 ⇒ 必须拒绝
 */
export type PostsMaterialization = 'durable-code-repo' | 'durable-content-repo' | 'ephemeral';

/** 拒绝原因（枚举取值固定；`posts.service.ts` 按它选提示文案，不做字符串推断） */
export type PostsWriteRejectionReason =
  | 'shirone-external-copy-prune'
  | 'mizuki-head-content-sync-disabled'
  | 'mizuki-head-no-content-dir'
  | 'content-source-unsupported'
  | 'theme-form-unknown';

/** 可写分支 */
export interface PostsWriteTargetOk {
  ok: true;
  form: ConfigWriteForm;
  materialization: PostsMaterialization;
  /** 绝对路径，**仅供后端内部使用**（仓规红线 6） */
  postsDirAbs: string;
  /** 写入后是否必须触发一次内容同步才生效（junction 写穿时为 true） */
  needsSync: boolean;
  /** 非致命提醒（相对口径；进日志与面板提示，绝不进错误 message） */
  notes: readonly string[];
  evidence: readonly ThemeProbeEvidence[];
}

/** 拒绝分支 */
export interface PostsWriteTargetRejected {
  ok: false;
  form: ConfigWriteForm;
  reason: PostsWriteRejectionReason;
  materialization: PostsMaterialization;
  /** 人话说明**下一步怎么做**；不含任何绝对路径 */
  message: string;
  notes: readonly string[];
  evidence: readonly ThemeProbeEvidence[];
}

export type PostsWriteTargetResolution = PostsWriteTargetOk | PostsWriteTargetRejected;

/** 目录判定（不存在 / 权限不足 → false，不抛） */
function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function exists(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

function reject(
  form: ConfigWriteForm,
  reason: PostsWriteRejectionReason,
  materialization: PostsMaterialization,
  message: string,
  notes: readonly string[],
  evidence: readonly ThemeProbeEvidence[],
): PostsWriteTargetRejected {
  return { ok: false, form, reason, materialization, message, notes, evidence };
}

/**
 * [T5b-1] 内容目录解析已**完全收敛**为 L0 单源：本文件不再保留任何本地包装。
 *
 * 原先本文件内联了一份 `.env` 读取与 `CONTENT_DIR` 解析，靠注释与
 * `config-write-target.ts` 互指保证一致（ADR-028 §22.5 记为「刻意的不收敛」）。
 * T5b-1 把两者提升为 `content-source.ts` 的导出（`resolveHeadEnv` / `resolveHeadContentDir`），
 * 四个调用点（config / posts / series / moments）直接调用同一实现，分叉隐患消除。
 */

/**
 * 判定当前主题档下「往代码仓 `src/content/posts` 写入」是否持久。
 *
 * @param root 主题根绝对路径（空串 / 不存在 ⇒ `theme-form-unknown` 拒绝，不抛错）
 */
export function resolvePostsWriteTarget(root: string): PostsWriteTargetResolution {
  const evidence: ThemeProbeEvidence[] = [];
  const notes: string[] = [];

  const { kind, layout, capabilities } = new ThemeAdapter().resolve(root);
  const postsDirAbs = layout.postsDir === '' ? '' : path.join(root, layout.postsDir);

  evidence.push({
    name: 'theme-kind',
    passed: kind !== 'unknown',
    detail: `kind=${kind}`,
  });

  // ── mizuki legacy：无内容分离，代码仓即真源 ────────────────────────────────
  if (kind === 'mizuki' && layout.configFile !== null) {
    evidence.push({ name: 'materialization', passed: true, detail: '无内容分离，代码仓即真源' });
    return {
      ok: true,
      form: 'mizuki-legacy',
      materialization: 'durable-code-repo',
      postsDirAbs,
      needsSync: false,
      notes,
      evidence,
    };
  }

  // ── mizuki HEAD：posts 走 junction 写穿内容仓 ⇒ 只要真物化过就持久 ─────────
  if (kind === 'mizuki' && layout.configFile === null && capabilities.config.strategy === 'overlay-ts') {
    const form: ConfigWriteForm = 'mizuki-head';
    const readEnv = resolveHeadEnv(root);

    if (readEnv('ENABLE_CONTENT_SYNC') === 'false') {
      evidence.push({
        name: 'content-sync',
        passed: false,
        detail: 'ENABLE_CONTENT_SYNC=false ⇒ sync-content.js 早退，posts 不被物化',
      });
      return reject(
        form,
        'mizuki-head-content-sync-disabled',
        'ephemeral',
        '内容同步被关闭（ENABLE_CONTENT_SYNC=false，可能来自主题根的 .env 或环境变量）：上游 sync-content.js 会直接早退，src/content/posts 不会被物化成内容仓的链接，写进去的文章下次同步也不会出现。下一步：去掉该环境变量或置为 true，重跑一次内容同步后重试。',
        notes,
        evidence,
      );
    }

    const contentDir = resolveHeadContentDir(root, readEnv);
    const contentDirOk = isDirectory(contentDir);
    const hasRepoUrl = (readEnv('CONTENT_REPO_URL') ?? '').trim() !== '';
    evidence.push({
      name: 'content-dir',
      passed: contentDirOk,
      detail: contentDirOk ? '内容目录存在' : '内容目录不存在',
    });

    if (!contentDirOk && !hasRepoUrl) {
      evidence.push({
        name: 'content-repo-url',
        passed: false,
        detail: 'CONTENT_REPO_URL 未设置 ⇒ 上游打印「将使用本地内容」后早退',
      });
      return reject(
        form,
        'mizuki-head-no-content-dir',
        'ephemeral',
        '没有可用的内容目录，也没有配置 CONTENT_REPO_URL：上游同步脚本会在这一步直接退出，src/content/posts 既不是内容仓的链接、也不会被刷新。下一步：把内容仓克隆成本地内容目录（或设 CONTENT_REPO_URL 让上游自行克隆），再重试。',
        notes,
        evidence,
      );
    }

    // 走到这里 = 上游会建立 junction（或 `CONTENT_REPO_URL` 会先克隆再建立）
    evidence.push({
      name: 'materialization',
      passed: true,
      detail: 'contentMappings 中 posts 无 copy:true ⇒ symlinkSync(junction) 写穿内容仓',
    });
    // 残留风险如实标注：symlink 失败时上游会降级为 copyRecursive，此时不再持久
    notes.push(
      'symlink-fallback-risk: 上游在 symlinkSync 失败时会降级为复制，该档下写入将不再持久；本判定按上游声明的物化意图给出',
    );
    return {
      ok: true,
      form,
      materialization: 'durable-code-repo',
      postsDirAbs,
      needsSync: true,
      notes,
      evidence,
    };
  }

  // ── shirone：复制 + prune 默认 true ⇒ 写代码仓必被抹掉，且无内容仓通道 ─────
  if (kind === 'shirone') {
    const form: ConfigWriteForm = 'shirone';
    const profile = resolveContentSource(root);
    const mode: ContentSourceMode = profile.mode;
    evidence.push({ name: 'content-mode', passed: mode === 'local', detail: `mode=${mode}` });

    if (!profile.supported) {
      evidence.push({
        name: 'manifest-version',
        passed: false,
        detail: `schemaVersion=${profile.schemaVersion}${profile.reason === null ? '' : `（${profile.reason}）`}`,
      });
      return reject(
        form,
        'content-source-unsupported',
        'ephemeral',
        '内容分离清单的结构版本不受支持：本服务无法判断内容仓的落点，因此不能安全地写入文章。下一步：把 shirone.content.json 的 schemaVersion 改回受支持的版本，或先升版本本服务。',
        notes,
        evidence,
      );
    }

    if (mode === 'local') {
      // local：主题仓自持内容，代码仓就是真源 ⇒ 持久
      evidence.push({ name: 'materialization', passed: true, detail: 'local 模式：代码仓自持内容' });
      return {
        ok: true,
        form,
        materialization: 'durable-code-repo',
        postsDirAbs,
        needsSync: false,
        notes,
        evidence,
      };
    }

    // external：唯一持久落点是内容仓，而 T4-3b 尚未接通该通道 ⇒ 拒绝
    evidence.push({
      name: 'materialization',
      passed: false,
      detail: `external + copyPreservingMtime + prune=${profile.prune ? 'true' : 'false'}：代码仓副本会在下次 sync 被裁剪或用源覆盖`,
    });
    return reject(
      form,
      'shirone-external-copy-prune',
      'durable-content-repo',
      '当前主题开启了内容分离（shirone.content.json + 独立内容仓）：文章的真源在内容仓，本服务写进代码仓 src/content/posts 的副本会在下次内容同步时被裁剪或用内容仓的版本覆盖，等于白写。本服务尚未接通「直接写内容仓文章目录」的通道（计划中）。下一步：在内容仓的 posts 目录里直接编辑文章，然后在面板的控制台跑一次内容同步任务让它物化进来。',
      notes,
      evidence,
    );
  }

  // ── unknown：主题根缺失 / 非主题目录 ─────────────────────────────────────
  evidence.push({ name: 'theme-kind', passed: false, detail: '主题形态无法识别' });
  return reject(
    'unknown',
    'theme-form-unknown',
    'ephemeral',
    '无法识别主题形态：主题根不存在、或该目录不是受支持的主题（缺少 src/config.ts / src/config/overrideLoader.ts / src/config/integrationsConfig.ts 等标志文件）。下一步：在设置里把主题根指向真正的 Mizuki 或 Shirone 主题目录后重试。',
    notes,
    evidence,
  );
}

/** 便利判定：是否允许写入（调用方多数只关心这一个布尔） */
export function canWritePosts(root: string): boolean {
  return resolvePostsWriteTarget(root).ok;
}

/** 便利判定：是否存在 `postsDirAbs`（供调用方判断是否需要先建目录；不写盘） */
export function postsDirExists(target: PostsWriteTargetOk): boolean {
  return target.postsDirAbs !== '' && exists(target.postsDirAbs);
}
