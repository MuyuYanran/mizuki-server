import { fileURLToPath } from 'node:url';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

// 仓库根 = 本配置文件所在目录（保证从任意 cwd 运行 eslint 时元素路径解析一致）
const repoRoot = fileURLToPath(new URL('.', import.meta.url));

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/data/**', '**/coverage/**'],
  },
  ...tseslint.configs.recommended,
  // ── [P0b] 依赖分层（MASTER-PLAN §4「依赖分层」段，eslint-plugin-boundaries 强制）──
  // L0 共享层：packages/shared、common/、infra/、config/（不依赖任何模块；L0 内部互导合法）
  // L1 引擎：data-files
  // L2 领域模块：collections / posts / albums / media / articles / settings（L2 之间互导禁止）
  // L3 编排传输：auth / system / process / backup（L3 之间互导合法，如 auth↔system 共用探测服务）
  // 测试入口（apps/server/test）不在元素清单内，天然不受 boundaries 约束。
  {
    plugins: { boundaries },
    settings: {
      'boundaries/root-path': repoRoot,
      // TS 无扩展名 import 的解析器（boundaries 依赖它把 import 定位到文件）
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: ['apps/server/tsconfig.json', 'packages/shared/tsconfig.json'],
          noWarnOnMultipleProjects: true,
        },
      },
      'boundaries/elements': [
        { type: 'l0', pattern: 'packages/shared/src/**' },
        { type: 'l0', pattern: 'apps/server/src/common/**' },
        { type: 'l0', pattern: 'apps/server/src/infra/**' },
        { type: 'l0', pattern: 'apps/server/src/config/**' },
        { type: 'l1', pattern: 'apps/server/src/modules/data-files/**' },
        { type: 'l2', pattern: 'apps/server/src/modules/collections/**' },
        { type: 'l2', pattern: 'apps/server/src/modules/posts/**' },
        { type: 'l2', pattern: 'apps/server/src/modules/albums/**' },
        { type: 'l2', pattern: 'apps/server/src/modules/media/**' },
        { type: 'l2', pattern: 'apps/server/src/modules/articles/**' },
        { type: 'l2', pattern: 'apps/server/src/modules/settings/**' },
        { type: 'l3', pattern: 'apps/server/src/modules/auth/**' },
        { type: 'l3', pattern: 'apps/server/src/modules/system/**' },
        { type: 'l3', pattern: 'apps/server/src/modules/process/**' },
        { type: 'l3', pattern: 'apps/server/src/modules/backup/**' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            { from: { element: { type: 'l0' } }, allow: { to: { element: { type: 'l0' } } } },
            { from: { element: { type: 'l1' } }, allow: { to: { element: { type: 'l0' } } } },
            {
              from: { element: { type: 'l2' } },
              allow: { to: { element: { types: { anyOf: ['l0', 'l1'] } } } },
            },
            {
              from: { element: { type: 'l3' } },
              allow: { to: { element: { types: { anyOf: ['l0', 'l3'] } } } },
            },
          ],
        },
      ],
    },
  },
);
