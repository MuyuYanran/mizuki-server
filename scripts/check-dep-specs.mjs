#!/usr/bin/env node
/**
 * 依赖 spec 守卫 —— 禁止 `latest` / `*` / `x` / 空 spec 进入任何一个 workspace 清单。
 *
 * [为什么需要它] 2026-10-29 事故：`apps/server/package.json` 的 24 个依赖全是 `"latest"`，
 *   一次普通的依赖安装就把它们重解析到最新（`vitest 4.1.11 → 5.0.5`、`eslint 10.9.1 → 10.13.0`），
 *   并让 `zod` 在仓内出现**两份副本**（4.4.3 与 4.6.7）。后果是 `pnpm build` 报 34 条
 *   `TS2739 ... missing validate, validateAsync` —— 跨副本的 `ZodType` 与 `ZodObject` 不是同一个类型，
 *   与业务代码毫无关系。`latest` 让构建**不可复现**：任何 install 都可能凭空改变行为。
 *
 * [本守卫的口径] spec 必须**锚定到一个具体版本或语义化范围**。允许本地/别名协议。
 * [接入方式] 挂在 `pnpm lint` 前面 ⇒ 自动进入「三连」与 CI，无需单独 step。
 * [失败即阻断] 有任何违规 ⇒ 退出码 1 并逐条打印。
 * [状态] ACTIVE
 */
import fs from 'node:fs';
import path from 'node:path';

const KINDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

/** 违规：浮动到「任意版本」或无数值下界 */
const FORBIDDEN_EXACT = new Set(['latest', '*', 'x', 'X', '']);

/** 允许的协议前缀（本地路径 / workspace / 别名 / 目录）——这些天然不指向 npm 的浮动版本 */
const LOCAL_PROTOCOL = [
  'workspace:',
  'link:',
  'file:',
  'portal:',
  'catalog:',
  'patch:',
];

/** 目录/文件级排除（构建产物与临时区不是「清单」） */
const SKIP_DIR = new Set([
  'node_modules',
  '.git',
  '.test-tmp',
  'dist',
  'build',
  'coverage',
  '.vite',
  '_attic',
  '.trash',
]);

function collectManifests(root) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIR.has(entry.name) || entry.name.startsWith('.')) continue;
        walk(path.join(dir, entry.name), depth + 1);
      } else if (entry.isFile() && entry.name === 'package.json') {
        found.push(path.join(dir, entry.name));
      }
    }
  };
  walk(root, 0);
  return found.sort();
}

/** 判定一个 spec 是否「已锚定」；返回 null 表示通过，否则返回违规原因 */
function inspect(spec) {
  if (typeof spec !== 'string') return '非字符串 spec';
  const trimmed = spec.trim();
  if (FORBIDDEN_EXACT.has(trimmed)) return `浮动 spec「${trimmed}」会随每次安装改变解析结果`;
  if (LOCAL_PROTOCOL.some((p) => trimmed.startsWith(p))) return null;
  // npm: 别名 —— 检查别名后的版本部分
  if (trimmed.startsWith('npm:')) {
    const at = trimmed.lastIndexOf('@');
    return at > 4 ? inspect(trimmed.slice(at + 1)) : null;
  }
  // 任何 open-ended 比较符都等于「无上界」
  if (/^(>=|>|<=|<)/.test(trimmed)) return `open-ended 范围「${trimmed}」不接受`;
  if (trimmed.includes('||')) return `联合范围「${trimmed}」无法保证可复现`;
  // git / url / github 形态：允许（由调用方自行钉 ref）
  if (/^(git\+|https?:|github:|gitlab:|bitbucket:)/.test(trimmed)) return null;
  // 必须锚定到一个数字版本（可带 ^ ~ 前缀）
  if (!/^[~^]?\d/.test(trimmed) && !/^\d/.test(trimmed)) {
    return `无法识别为锚定版本：「${trimmed}」`;
  }
  return null;
}

const root = process.cwd();
const manifests = collectManifests(root);
const violations = [];

for (const manifestPath of manifests) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    violations.push({ manifestPath, name: '(清单本身)', reason: `JSON 解析失败：${error.message}` });
    continue;
  }
  for (const kind of KINDS) {
    for (const [name, spec] of Object.entries(manifest[kind] ?? {})) {
      const reason = inspect(spec);
      if (reason !== null) violations.push({ manifestPath, name, reason, kind });
    }
  }
}

const rel = (p) => path.relative(root, p).split(path.sep).join('/');
if (violations.length > 0) {
  console.error('[check-dep-specs] 依赖 spec 守卫失败：\n');
  for (const v of violations) {
    console.error(`  ${rel(v.manifestPath)}  ${v.kind ?? ''}  ${v.name}  ->  ${v.reason}`);
  }
  console.error(
    `\n共 ${violations.length} 处。请钉到具体版本（例如 "4.1.11"）或语义化范围（例如 "^4.1.11"）。`,
  );
  console.error('理由：浮动 spec 会让构建不可复现，且可能在仓内造成同一包的多个副本（类型不互认）。');
  process.exit(1);
}

console.log(`[check-dep-specs] 通过：${manifests.length} 个清单，无浮动 spec。`);
