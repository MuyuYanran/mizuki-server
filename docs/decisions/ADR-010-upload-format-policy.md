# ADR-010: 上传格式策略——媒体/相册保留原格式，posts 封面维持转 JPG

| 字段 | 内容 |
|---|---|
| 状态 | 已采纳 |
| 日期 | 2026-10-20 |
| 阶段 | U3-P3（T6 补建；编号由 R2-7 点名预留，文件在 R2-7 落地时未建） |

## 背景

本 ADR 记录上传格式策略的**完整弧线**：一期的「一律转 JPG」原决策、二期 R2-7 对它的
废止与双口径分化，以及最终落到代码里的三套口径。R2-7 规格明文要求「记 ADR-010
（一期转 JPG 的原决策及废止理由）」，但该文件从未建档——本文件为补建，编号沿用
R2-7 预留号（028 号段已按语境预留，勿回填）。

相关规格与决策：`docs/REQUIREMENTS-PHASE2.md` R2-7、`docs/decisions/ADR-017-upload-whitelist-final.md`
（白名单终集）、B2 终版裁决 2/3。

## 决策

**上传格式策略按域分三套口径，各有其约束来源：**

| 域 | 策略 | 落点 | 理由 |
|---|---|---|---|
| **媒体库**（`/admin/media`） | **保留原格式**（仅剥离 EXIF/元数据）；bmp 防御拒绝 | `modules/media/media.service.ts` | 媒体库是通用素材池，格式保真是用户诉求；bmp 因 sharp 0.35 无法解码、无法满足 `media_file` 尺寸契约而拒绝（ADR-017 双口径延伸） |
| **相册**（`/admin/albums`） | **保留原格式**（原样落盘）；bmp 准入但跳过 sharp probe | `modules/albums/albums.service.ts` | 相册面向静态站点展示，官方本地模式支持九种格式；bmp 无缩略图变体（ADR-019） |
| **文章封面**（`/admin/posts/:slug/cover`） | **维持转 JPG**（sharp 解码 → `.rotate()` → `.jpeg()`，顺带去 EXIF）→ 原子写 `cover.jpg` → frontmatter `image: 'cover.jpg'` | `modules/posts/posts.service.ts` `uploadCover` | **B2 裁决 2/3**：封面是单文件固定槽位（`cover.jpg`），主题按 `image` 字段消费，需稳定后缀与可控体积；转 JPG 同时完成解码校验与 EXIF 剥离 |

**白名单终集**（ADR-017）：`jpg/jpeg/png/gif/webp/avif/bmp/tiff/tif` 九扩展名，
`svg` 维持排除（可内嵌脚本，管理面上传安全边界优先）。媒体库面 bmp 防御拒绝、
相册面准入（双口径并存，依据见 SESSIONS C2a 判卷）。

## 备选方案

1. **全域一律转 JPG**（一期口径）——被 R2-7 废止。理由：转码会破坏 WebP/AVIF 等
   现代格式的体积优势，且与官方「本地模式支持九种格式」的静态站点预期冲突；
   官方场景本就是文件直放，不需要服务端转码。
2. **全域一律保留原格式**——未采纳。文章封面是**固定槽位**（`cover.jpg`），
   保留原格式会导致同一篇文章的封面文件名随上传格式漂移（`cover.webp` /
   `cover.png`），frontmatter `image` 字段随之变动，与主题消费约定（固定名）
   不合；且封面体积敏感（列表页缩略图），JPG 的可控体积更稳。
3. **封面也保留原格式 + 允许自定义文件名**——未采纳。放开文件名会让 frontmatter
   `image` 指向的文件名不可预测，且与既有 `cover.jpg` 约定冲突，收益不足。

## 理由

- **契约分层清晰**：媒体/相册是「素材落盘」，格式即用户意图；文章封面是
  「主题消费槽位」，格式是实现细节。二者本就不同诉求，用一条规则覆盖会两头不讨好。
- **安全边界不放松**：转 JPG 的路径本身提供了一次解码校验（无法解码 → 400），
  封面保留该校验是额外收益。
- **EXIF 隐私**：封面转 JPG 时顺带 `.rotate()`（EXIF auto-orient）并剥离元数据；
  媒体/相册的「仅剥 EXIF」由各自管线独立保证。

## 影响

- 证据链：`apps/server/test/p7c-album-fields.e2e-spec.ts` b3 三用例（bmp/tiff
  原格式落盘、伪造魔数拒绝）、`p7-media-albums` 基线用例、`magic-sniff.spec.ts`；
  封面侧见 `p5e-file-form-lifecycle` / `p5-posts` 既有断言（产物固定 `cover.jpg`）。
- 文案面：albums/media 的 Swagger summary 与前端注释曾写「非 JPG 自动转 JPG」
  （与原格式落盘不符），已在 U3-D 批订正（见 `docs/audits/feature-alignment/README.md`）。
- 已知限制：媒体库面 bmp 无法生成缩略图变体（sharp 解码能力所限），相册面同此。
- 本 ADR 只**记录**既有实现与取舍，不引入新的代码变更；如未来调整任一域的
  策略，须新开 ADR 并同步修订 R2-7 规格文本。
