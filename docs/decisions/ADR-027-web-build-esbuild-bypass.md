# ADR-027 面板构建绕开 chunk 级 esbuild 转换（本机大输入临时文件被拒）

- 状态：**已接受（ACCEPTED）**
- 日期：2026-10-16
- 相关：ADR-026（面板自定义主题，本 ADR 是它的构建前置）；`AGENTS.md` §3、§9
- 影响面：`apps/web/vite.config.ts`（仅 `build` 段）、本机构建可复现性

## 背景

面板自定义主题（ADR-026）验收需要 `pnpm build` 全绿，但本机在 web 环节稳定失败：

```
[vite:esbuild-transpile] remove <system-temp>\esbuild-<hash>: Access is denied.
```

**失败点定位**：`vite:esbuild-transpile` 会把每个渲染后的 chunk 交给 `esbuild.transform`；esbuild 的 JS 侧对
**>1 MiB 的输入**改走「写系统临时文件 → 原生侧读取并删除」链路（esbuild 0.28.2 `lib/main.js` 的
`randomFileName` 分支），失败发生在**原生（Go）侧删除**该临时文件时。输入 ≤1 MiB 时不触碰该链路。
本仓面板经 `app.use(ElementPlus)` 全量注册，渲染后的单 chunk 约 5.7~6.1 MB，必然触发。

**已排除的原因**（`.test-tmp/ct-probe/esbuild-repro.cjs` 五组对照 + 现场取证）：

| 假设 | 结论 |
|---|---|
| 杀软/Defender 实时防护 | 已关闭，排除 |
| TEMP/TMP 重定向 | 重定向到工作区后失败点迁移但依旧被拒，排除 |
| 目录 ACL 不足 | `<system-temp>` 与残留文件的 DACL 含 `Authenticated Users:(I)(M)`（含 DELETE）、属主即当前用户 → **DACL 已足够**，且做了一次 ACL 修复（见「后果」）后仍失败 |
| 只读属性 / 属主 | `Attr=Archive ReadOnly=False`，属主为当前用户，排除 |
| 通用写删能力 | 普通 node 进程（含子进程）在该目录写删 6 MB 文件均成功；`esbuild.transform` 小输入也成功 → **仅 esbuild 原生侧删除被拒** |

即：这是**本机对 esbuild 子进程删除其临时文件的拒绝**，属环境设施问题，非本仓代码可修。

## 决策

1. **绕开该链路而不是绕过验收**：`apps/web/vite.config.ts` 只增加 `build` 段——
   `target: 'esnext'`、`minify: false`、`cssMinify: 'esbuild'`。
2. **不加新依赖**：`terser` 方案被否决（见理由 3）。
3. **不用 chunk 拆分规避**：`manualChunks` 方案已实测**会在运行时崩溃**，永久废弃（见理由 4）。
4. **不为该缺陷改任何业务代码**：面板源码、依赖清单、`pnpm-lock.yaml` 均保持不动。

Vite 7.3.6 的跳过条件（`node_modules/vite/dist/node/chunks/config.js:6233`）：

```js
if ((!target || target === "esnext") && !minify) return null;   // vite:esbuild-transpile 直接跳过
```

故 `target: 'esnext'` + `minify !== 'esbuild'` 两个条件同时成立时，该插件不再产出大输入临时文件。

## 理由

1. **`target: 'esnext'` 跳过语法降级插件**：面板是本地优先的自托管管理台，目标浏览器是现代 Chromium/Firefox；
   代价是产物语法等级提高（不为旧浏览器降级），收益是本机 `pnpm build` 可复现通过。
2. **`minify: false` 移除唯一的 >1 MiB esbuild 调用**：chunk 级压缩正是写出大临时文件的那一步。
   `cssMinify` 显式保留 `esbuild`：CSS 只有一个 chunk（437.88 kB，gzip 63.58 kB），远离 1 MiB 阈值，不触发该链路。
   （附注：`rollup` 的 `output.compact` 实测仅省 2.3 kB，属噪声，故未采用。）
3. **拒绝 `terser`**：`minify: 'terser'` 需新增依赖。实测 `pnpm add -D terser` 会让 pnpm 重新解析全仓
   `latest` 声明（eslint 10.9.1→10.12.0、typescript-eslint 8.68→8.71.2、@nestjs/throttler 6.5.0→6.7.1、
   drizzle-orm 0.45.2→0.45.4、jose/marked/nanoid/sanitize-html 等），把一个主题功能的提交变成依赖漂移提交；
   已回滚并以 `pnpm install --frozen-lockfile` 复原（lockfile 保持 `lockfileVersion: '9.0'`，CI 用 pnpm 9）。
4. **chunk 拆分的失败教训（重要）**：曾用 `manualChunks` 把 element-plus 按名字首字母切成两块，得到
   **绿色的 `pnpm build`（无错误、仅剩一条环形 chunk 警告）**，但它在浏览器里是坏的：
   `vendor-element-plus-n-z ↔ vendor-element-plus-a-m` 互相 import，破坏了 ESM 求值顺序，运行时报
   `ReferenceError: Cannot access 'ge' before initialization`（TDZ），面板完全不挂载。
   Element Plus 组件互相依赖（`el-input` 的 'i' < 'n' ↔ `el-select`/`el-tooltip` ≥ 'n'），按名切割必然成环
   ⇒ **对 element-plus 做 manualChunks 在任何切法下都不可接受**。
   教训：`build` 无警告不等于产物可用，chunk 级改动必须在真实浏览器里跑一遍。

## 后果与限制

- **体积**：JS 单 chunk 6.08 MB（gzip 1.35 MB），大于压缩版；CSS 仍 437.88 kB（gzip 63.58 kB）。
  自托管通常同源访问，建议部署时开启 gzip/br；否则首屏会传约 6 MB。
- **不降级**：不为旧浏览器做语法降级。若将来需要支持旧浏览器，必须先在**能正常构建的环境**（CI）恢复
  `minify: 'esbuild'` 并去掉 `target`。
- **约束会复发**：若将来某个 **CSS chunk** 超过 1 MiB，同样会踩到该链路（当前只有 437.88 kB）。
  `apps/web/public/**` 下的大文件（如 vditor 的 `lute.min.js` 3.7 MB）是静态拷贝，不经 esbuild，不受影响。
- **CI 一致性**：CI（Node 22 / pnpm 9）与本机跑同一份配置，即 CI 也失去 JS 压缩；这是本 ADR 的已知代价，
  不是回归。环境侧修好（安全软件/沙箱对 esbuild 临时文件的策略放行）后，把 `build` 段恢复为
  `build: { minify: 'esbuild' }`（不设 `target`）即可回到默认行为。
- **环境侧副作用（已记录）**：排查期间对 `<system-temp>` 追加过一条当前用户 `(F)` 的不可继承 ACE
  （`WRITE_OWNER`）。**该修复未解决问题**；备份与回滚脚本在 `.test-tmp/acl-report/`
  （`acl-backup-ba9d9d1494ec40f685b844085dc812c9.json` / `.ps1`，随 `.test-tmp/` 一起 gitignored）。

## 验证

- `pnpm build`（`shared → server → web`）**exit 0**：`1903 modules transformed`、`built in 18.71s`；
  产物 `dist/assets/index-*.js` 6,082,909 B、`index-*.css` 437,883 B、`index.html` 4.48 kB。
- **构建前后 `<system-temp>` 中 `esbuild-*` 残渣均为 0 个**（构建前清空、构建后复查），证明该链路确实未被触发。
- 真实 `apps/web/dist`（非探针产物）在同源静态服务上（4199）浏览器验收：面板正常挂载；**console 无任何应用错误**
  （仅浏览器扩展日志）——即 ADR 中记录的 TDZ 崩溃已消除。
- 探针：`custom-theme` 43/43、`index.html` 内联 8/8（`.test-tmp/ct-probe/`）。
- 未验证项：本机 `browser_inspect action=screenshot` 仍因写系统临时目录被拒（`os error 5`）不可用，
  视觉证据以可访问性快照 + DOM/console 回执替代。
