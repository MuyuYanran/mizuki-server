# 任务：媒体上传与相册（阶段 P7）

## 0. 任务定位

你是 Mizuki-Server 项目的实施 AI。本项目采用**分阶段提示词驱动**开发：每次会话只完成一个阶段，严禁越界。本次是阶段 **P7**，前置依赖阶段：**P6（Auth + 初始化）**。

本会话范围一句话：**实现媒体上传管线（扩展名白名单 + 魔数嗅探 + 10MB 上限 + 随机文件名 + sharp 重编码）、媒体索引、相册目录与 info.json 管理，并落地 `MediaReferenceContributor` 注册表（四模块注册）与删除前引用检查（409 + 明细）**。

只做本阶段：除 §2 列出的文件外，任何 stub 保持 SKELETON 原样。

## 1. 上下文注入（按顺序读完再动笔）

1. `docs/MASTER-PLAN.md`：§7「上传」（上传管线五件套）、§2 决策 6（同步反查走注册表）、**§4.4 同步通道表**（`MediaReferenceContributor` 注册方/消费方）与事件表 `media.changed` 行、§3 `media_file` 表、§5「Albums」「Media」路由清单、§4 分层（albums/media 属 L2）
2. `docs/REQUIREMENTS.md`：**§6.9**（albums info.json 字段，逐字依据）、§6.8（devices 图片目录）、§6.5/§6.3（projects.image / diary.images）、§7 第 7 条（文件与媒体管理：引用检查）、§9 第 5 条
3. `CHANGELOG.md`：P6 条目（最近一条）
4. `docs/decisions/` 全部 ADR。注意 P0a 勘误：`@types/tree-kill` 已移除，不得引用
5. `docs/SESSIONS.md` 最近记录（如有）
6. 本阶段 stub 文件头注释：
   - `apps/server/src/modules/media/media.module.ts`、`media.controller.ts`、`media.service.ts`（[P7]）
   - `apps/server/src/modules/albums/albums.module.ts`、`albums.controller.ts`、`albums.service.ts`（[P7]）
7. 已实现的前置件：`infra/db`（media_file 表）、`common/security/safe-join.ts`、`infra/backup`、`packages/shared/src/events.ts`（EVENTS.MediaChanged）、P5 `common/markdown/`、P4 collections registry

## 2. 实现文件清单

**本次转正的 stub（阶段标注与本清单一致）**：

- `apps/server/src/modules/media/media.module.ts`（[P7]）
- `apps/server/src/modules/media/media.controller.ts`（[P7]）
- `apps/server/src/modules/media/media.service.ts`（[P7]）
- `apps/server/src/modules/albums/albums.module.ts`（[P7]）
- `apps/server/src/modules/albums/albums.controller.ts`（[P7]）
- `apps/server/src/modules/albums/albums.service.ts`（[P7]）

**本阶段允许新建的文件（仅限以下）**：

- `packages/shared/src/media-reference.ts` — `MediaReferenceContributor` 接口（类型定义，接口签名照搬 §3.4；shared 只放类型）
- `apps/server/src/common/registry/media-reference.registry.ts` — 注册表宿主（放 common/ 属 L0，供 media 与各注册方共同依赖，避免 L2 互 import）
- `apps/server/src/common/security/magic-sniff.ts` — 最小魔数嗅探器（纯函数，四格式：JPEG `FF D8 FF` / PNG `89 50 4E 47` / WebP `RIFF…WEBP` / GIF `GIF87a`|`GIF89a`；人工已裁决，不引入 file-type，见 §4 第 4 条）
- `apps/server/test/` 下本阶段测试文件

**本阶段允许修改的既有实现文件（注册方登记，见 §3.4）**：

- `apps/server/src/modules/posts/posts.module.ts`（注册 posts 的引用检查器）
- `apps/server/src/modules/collections/collections.module.ts`（注册 collections 的引用检查器）
- 注册所需的轻量检查器实现文件（`posts/media-reference.ts`、`collections/media-reference.ts`，本阶段允许新建）

**禁止实现的其他 stub（保持 SKELETON，不得接线）**：

`modules/articles/*`（P8——其引用检查器注册在 P8 完成）、`modules/process/*`（P9）、`modules/settings/*`（P8）。

## 3. 详细规格

### 3.1 上传管线（MASTER-PLAN §7 逐字五件套）

`POST /admin/media`（multipart）依次执行：

1. **扩展名白名单**：`jpg / jpeg / png / webp / gif`（其余一律拒）；
2. **魔数嗅探**：用 `common/` 下自实现的最小嗅探器（纯函数，四格式：JPEG `FF D8 FF` / PNG `89 50 4E 47` / WebP `RIFF…WEBP` / GIF `GIF87a`|`GIF89a`）识别真实类型，必须与扩展名白名单比对一致；内容与扩展名不符（如文本文件改名 `.png`）拒绝；sharp 解码失败兜底拒绝；
3. **10MB 上限**（超限 413）；
4. **随机文件名**：`<nanoid>.<ext>`，写入 `public/images/uploads/`（相对 Mizuki 根；目录不存在则创建，路径经 `safeJoin`）；
5. **sharp 重编码**：按原格式重编码（**顺带去 EXIF 与图片内嵌 payload**）；同时读取宽高写入索引。

成功后写 `media_file` 表（MASTER-PLAN §3 逐字）：`id, path UNIQUE（相对 Mizuki 根）, original_name, mime, size, width?, height?, sha256, created_at`。

### 3.2 REST API（MASTER-PLAN §5 逐字）

**Media**（全部需认证）：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/admin/media` | multipart 上传 |
| GET | `/admin/media` | 媒体列表 |
| DELETE | `/admin/media/:id` | 删除（**删除前做引用检查**，见 §3.5） |

**Albums**（全部需认证）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/albums` | 相册列表 |
| POST | `/admin/albums` | 创建相册（目录 + info.json） |
| PATCH | `/admin/albums/:id` | 修改相册元信息 |
| DELETE | `/admin/albums/:id` | 删除相册 |
| POST | `/admin/albums/:id/images` | 上传相册图片（**非 JPG 自动转 JPG**） |
| DELETE | `/admin/albums/:id/images/:name` | 删除相册内单张图片 |

（相册 `:id` 用目录名；命名经 `safeJoin` 校验。）

### 3.3 相册（REQUIREMENTS §6.9 逐字）

- 目录：`public/images/albums/<相册名>/`，内含图片文件与 `info.json`。
- info.json 字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| title | string | 是 | |
| description | string | 否 | |
| date | string | 否 | |
| location | string | 否 | |
| tags | string[] | 否 | |
| layout | string | 否 | 布局方式 |
| columns | number | 否 | 列数 |

- 功能：相册列表 / 创建 / 修改 / 删除 / 上传图片 / 上传封面 / 删除图片 / 图片预览 / **非 JPG 图片自动转 JPG**（sharp；转码后文件名保持 `<原名>.jpg` 语义，同名冲突按随机后缀处理并记报告）。
- 相册图片上传复用 §3.1 的白名单+魔数+10MB 校验（转 JPG 是相册特有步骤）。
- info.json 读写用 zod 校验；相册删除前同样走引用检查（相册封面被引用时 409）。

### 3.4 `MediaReferenceContributor` 注册表（签名逐字照搬，消费方：media）

接口定义于 `packages/shared/src/media-reference.ts`（签名如下，字段名不得更改）：

```ts
export interface MediaReference {
  refType: string;      // 'post-cover' | 'diary-image' | 'project-image' | 'device-image' | 'album-cover' | ...
  targetLabel: string;  // 人类可读引用方标识（文章 slug / 条目 id / 相册名）
  mediaPath: string;    // 被引用的媒体相对路径（相对 Mizuki 根）
}

export interface MediaReferenceContributor {
  readonly name: string;                          // 模块名：'posts' | 'collections' | 'albums' | 'articles'
  collectReferences(): Promise<MediaReference[]>; // 聚合本模块对媒体的全部引用
}
```

注册表（`common/registry/media-reference.registry.ts`）：可注入的 Registry 类，`register(contributor)` / `collectAll(): Promise<MediaReference[]>`（聚合全部注册方，内部对每个贡献者调用做 try/catch，失败记日志不冒泡）。以 `@Global()` 模块经 `app.module.ts` 提供。

**四模块注册分工（生成规则 8：注册方与调用方分属不同阶段，两侧都写明）**：

| 注册方 | 注册阶段 | 检查内容 |
|---|---|---|
| posts | **P7（本阶段）** | 各文章 frontmatter `image`（封面）引用 |
| collections | **P7（本阶段）** | diary `images[]`、projects `image`、devices `image`（按各注册表项的 imageDir/字段聚合） |
| albums | **P7（本阶段）** | 相册封面引用（info 层，如无封面字段则以相册图片目录互查为准——取舍记报告） |
| articles | **P8** | `article.cover` 引用（P8 提示词含该注册规格） |

> 注意：注册方实现只读取既有数据（posts 文件 / collections 数据文件 / albums 目录），经各自已有 service 能力或只读扫描实现；**不得产生 L2 互 import**（albums 作为注册方注册自己的检查器在 media 注册表，属注册而非互调）。

### 3.5 删除前引用检查（消费方：media）

- `DELETE /admin/media/:id`：先 `collectAll()` 聚合，若目标 `path` 出现在任一 `MediaReference.mediaPath` → **409 + 响应体含引用明细数组**（`refType` + `targetLabel`）；无引用则删除物理文件 + `media_file` 行。
- 相册内图片删除同理（相册图片互相引用按相册贡献者检查）。

### 3.6 事件（发射方，MASTER-PLAN §4.4 逐字）

- **`media.changed`**（EVENTS.MediaChanged）：media 上传保存与删除成功后发射 `{ path: string, op: 'save' | 'delete' }`；albums 图片保存/删除同样发射（`path` 为相对 Mizuki 根的相册图片路径）。发射前 `MediaChangedPayload.parse`；恰好一次、失败不发。
- **`content.changed`**（EVENTS.ContentChanged）：**相册元数据写入**（创建相册/修改 info.json/删除相册）成功后发射 `{ scope: 'album', filePaths: ['public/images/albums/<相册名>/info.json'] }`（§4.4 事件表 `content.changed` 发射方含 albums，`scope` 枚举含 `'album'`，即由本处落地）。发射前 `ContentChangedPayload.parse`。
- 订阅方（媒体索引/统计）：媒体索引在本阶段由写入路径直接落库完成；统计订阅在 P10d。本阶段用测试订阅者断言。

### 3.7 日志

pino 记录：上传（原名/最终名/尺寸）、重编码、删除（被拒时记录引用数）。

## 4. 接线说明

1. `media.module.ts` / `albums.module.ts`：填充 controllers/providers；均已注册于 `app.module.ts`（P0a 占位）。
2. `app.module.ts`：追加全局 `MediaReferenceRegistryModule`（@Global）；posts/collections 模块各自 `register` 自己的贡献者（模块 `onModuleInit` 或 provider 装配）。
3. 依赖注入：`DbModule`（media_file）、`AppConfig`（mizukiRoot）、`BackupService`（删除/覆盖前备份）、`EventEmitter2`、`MediaReferenceRegistry`。
4. 依赖（人工已裁决，定案）：**不引入 `file-type`**——在 `common/security/magic-sniff.ts` 自实现最小魔数嗅探器（纯函数，四格式：JPEG `FF D8 FF` / PNG `89 50 4E 47` / WebP `RIFF…WEBP` / GIF `GIF87a`|`GIF89a`），与扩展名白名单比对；sharp 重编码步骤对无法解码的内容兜底拒绝。记 ADR：`file-type@16` 已停止维护、v17+ 为 ESM-only 与本项目 CJS（`module: commonjs`）不兼容。**本阶段零新增依赖。**
5. 分层自检：media/albums（L2）只依赖 L0（common/infra/shared），不 import posts/collections；引用检查一律经注册表（同步反查）。

## 5. 禁止事项

逐字继承 P0a §5 全部 7 条：

1. 禁止创建第 3 节目录树之外的任何文件；禁止遗漏树中文件。
2. 除第 4.1 节列出的 6 个文件外，其余一律为 stub——**哪怕看起来“顺手就能写完”也禁止实现**。
3. 禁止把任何 stub（guard/filter/pipe/interceptor/service）接入 Nest 管道或模块注册——接线属于实现阶段。
4. 禁止安装依赖清单之外的包，禁止删减清单内的包。
5. 禁止 `any`、`as any`、`@ts-ignore`，禁止关闭 strict。
6. 禁止执行任何 git 操作（init/commit 由人工执行）。
7. 依赖安装失败或版本冲突时：**停下并报告**，不得自行更换替代库。

> 本阶段适用解释：第 1 条“第 3 节目录树”= 本提示词 §2 文件清单；第 2 条 = 除 §2 转正文件与明列的新建文件外，其他 stub 一律保持 SKELETON；第 3 条 = 本阶段接线仅限 §2/§4 明列；第 4 条 = 本阶段零新增依赖（魔数嗅探自实现，人工定案：不引入 `file-type`，理由记 ADR）。

**本阶段专属禁止**：

- 无（本阶段不设额外专属禁止；通用守则照常生效）。

## 6. 验收标准

先执行且必须全绿：

```
pnpm test && pnpm build && pnpm lint
```

随后逐项（全部可机械执行，e2e 用 supertest，数据源为假 Mizuki 项目临时副本，需先完成 init/login 拿 token——沿用 P6 测试装配）：

1. **伪造扩展名被拒**：文本文件改名 `.png` 上传 → 400（魔数嗅探拒绝）；合法图片各格式（jpg/png/webp）上传成功且落 `media_file`。
2. **10MB 上限**：超限文件 → 413。
3. **重编码去元数据**：上传含 EXIF 的 JPEG（可用 sharp 现场构造）→ 落盘产物 `exif` 为空/不含原 EXIF 段。
4. **被引用图片删除被拒**：构造文章封面引用某媒体（fixture 内 frontmatter `image` 指向该路径）→ `DELETE /admin/media/:id` 返回 **409 且响应体含引用明细**（`refType`/`targetLabel` 可断言）；无引用媒体删除成功（文件与表行均消失）。
5. **四模块注册断言**：`collectAll()` 返回的贡献者名集合含 `posts / collections / albums`（articles 在 P8 注册，本阶段断言注册表机制可容纳——用测试贡献者验证第 4 个插槽），且 `name` 唯一。
6. **相册 CRUD 往返**：创建相册（info.json 全字段）→ 列表断言 → PATCH 改字段 → 重读一致；上传 PNG 到相册 → 断言产物为 JPG；删除单张图片 → 目录与列表更新。
7. **路径防护**：相册名/图片名含 `../` → 拒绝。
8. **事件断言**：测试订阅者——上传后收到 `media.changed` `{op:'save'}`，删除后 `{op:'delete'}`，payload 过 `MediaChangedPayload.parse`；创建/修改相册后收到 `content.changed`（`scope:'album'`，payload 过 `ContentChangedPayload.parse`）。
9. **回归**：P0a–P6 既有用例全绿。
10. **测试下限**：本阶段测试文件 ≥2，用例总数 ≥ 本阶段锚点数（合计 ≥16 条）。

## 7. 交付报告要求

1. 文件清单：转正/新建/修改的全部文件路径（含注册表与两个注册方检查器）。
2. 测试结果：`pnpm test` 用例数与通过数；§6 各项逐条结果。
3. 偏差清单：理想为空；相册封面引用口径、同名图片冲突处理须显式列出并记 ADR（`file-type` 不引入为人工定案，仅需在 ADR 中记录裁决理由）。
4. `CHANGELOG.md` 追加 P7 条目。

## 8. 冲突处理

若规格与现实冲突（如 API 变更、包不存在、Nest 版本行为不同）：停下、描述冲突、给出不超过 2 个候选方案等待人工选择，**不得静默变更**。指令内部有歧义时，采用“更保守、更少代码”的解释并在报告中说明。
