# ADR-017: 上传白名单终集修订（+bmp+tiff，svg 维持排除）

| 字段 | 内容 |
|---|---|
| 状态 | 已采纳 |
| 日期 | 2026-08-29 |
| 阶段 | Phase3-C2a（相册字段面对齐 + 白名单重裁决） |

## 背景

B4 审计曾裁定 bmp 为「白名单放行即必 400 的死入口」（sharp 0.35 预编译版无法解码 bmp，重编码/解码兜底全链路不存在），tiff 因放行层排除同样拒收。该前提在 B2 裁决 2（原格式落盘，移除强制转码）落地后失效：上传管线不再要求解码重编码，原格式直落盘即可。

## 决策

上传白名单终集修订为 `jpg/jpeg/png/gif/webp/avif/bmp/tiff/tif` 九扩展名；`svg` 维持排除。

## 理由

- 官方本地模式支持九种格式（含 .bmp/.tiff/.tif）——白名单向官方静态站点列表收敛；
- svg 维持排除：SVG 可内嵌脚本，管理面上传安全边界优先；官方场景为本地放置文件（无上传面），两口径并存（B4 疑问 4 备案）；
- bmp 免解码直落盘：魔数嗅探（`BM` 两字节）先于落盘拒绝伪造件，probe/转码分支对 bmp 跳过，消除死入口。

## 影响

- `magic-sniff.ts`：`MagicFormat` +`bmp`、`EXTENSION_FORMAT` +`.bmp/.tiff/.tif`、BMP 魔数识别（含单测）；
- 放行层（albums/media 共用常量）：+tiff+bmp；albums 管线 bmp 跳过 sharp probe；media 管线 bmp 重编码不可达（防御拒绝）；
- 错误文案同步（albums/media 白名单提示含 bmp/tiff）；
- 证据链：`apps/server/test/p7c-album-fields.e2e-spec.ts` b3 三用例 + 基线 `p7-media-albums` tiff 用例修订 + `magic-sniff.spec.ts` 修订/新增。

> C2a 判卷定案：媒体库面 bmp 防御拒绝（sharp 无法解码、无法满足 media_file 尺寸契约），相册面准入（原格式落盘）——两口径并存依据见 SESSIONS C2a 判卷。

> C4 延伸（2026-08-29）：缩略图变体 bmp 跳过系本 ADR 双口径延伸（sharp 无法解码故无法生成）；tiff 变体限相册面（媒体库面零触碰），见 ADR-019。
