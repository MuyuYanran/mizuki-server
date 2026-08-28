# B4 摘录卡 — Mizuki 官方文档快照规格摘录

- 快照基座：`docs/refs/mizuki-docs/`（来源 `https://docs.mizuki.mysqil.com/`，快照日期 2026-08-28，各页文档日期见各文件头部快照说明）。
- 用途：Phase2-B4 规格对齐审计（`docs/SPEC-ALIGNMENT-B4.md`）的证据基座。本文件只摘录「与 Server 管理面相关的规格原文」，每条标注 `快照文件名 §小节`；摘录力求完整（宁全勿缺），但以数据格式/目录约定/格式支持为准，纯样式与页面交互不摘。
- 引用格式：`<文件名> §<小节名>`。全文逐字摘录以「」或代码块包裹。

---

## 1. special-friends.md（友链）

- §2 interface 原文：

```ts
export interface FriendItem {
  id: number;
  title: string;
  imgurl: string;
  desc: string;
  siteurl: string;
  tags: string[];
}
```

- §2 字段说明：「`id: number`: (必填) 友情链接的唯一标识符。**必须是数字，且不能重复**。通常按添加顺序递增。」「`title: string`: (必填)」「`imgurl: string`: (必填) 网站头像或Logo的URL地址。建议使用正方形图片，尺寸为640x640像素。」「`desc: string`: (必填) 网站的简短描述。」「`siteurl: string`: (必填) 网站的URL地址，需要包含协议（http://或https://）。」「`tags: string[]`: (必填) 标签数组，用于分类。**至少包含一个标签**。」
- §3 添加约束：「`id` 给一个新的、唯一的数字」「`desc` 建议控制在 50 个字符以内」「`tags` 添加适当的标签，**至少一个**」。
- §5 高级功能：随机排序函数 `getShuffledFriendsList()`（对 `friendsData` 的消费方式，Server 写文件须兼容数组形态）。
- §1 数据位置：`src/data/friends.ts`，导出变量 `friendsData: FriendItem[]`。

## 2. special-gallery.md（相册）

- §基础配置：「每个相册都需要一个 `info.json` 配置文件，位于相册文件夹内。」目录结构：`public/images/albums/<相册名称>/info.json`；「`cover.jpg # 本地模式必需：封面图`」「外链模式只需配置文件」。
- §通用字段说明（info.json）逐字表格：

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `mode` | string | 否 | 模式设置，"external" 为外链模式，不设置为本地模式 |
| `hidden` | boolean | 否 | 是否隐藏相册，true 为隐藏 |
| `title` | string | 否 | 相册标题 |
| `description` | string | 否 | 相册描述 |
| `date` | string | 否 | 创建日期，格式：YYYY-MM-DD |
| `location` | string | 否 | 拍摄地点 |
| `tags` | array | 否 | 标签数组 |
| `layout` | string | 否 | 布局方式："grid" 或 "masonry" |
| `columns` | number | 否 | 列数，默认 3 |

- §本地模式详解/文件命名规则：「**封面图必须命名为 `cover.jpg`**」「其他图片可以任意命名」「支持中文文件名」；「系统会自动扫描文件夹内的所有图片」「自动获取文件修改时间作为拍摄日期」。
- §支持的图片格式逐字：「`.jpg` / `.jpeg`、`.png`、`.gif`、`.webp`、`.svg`、`.avif`、`.bmp`、`.tiff` / `.tif`」。
- §外链模式详解：`info.json` 须含 `"mode": "external"`、`cover`（外链封面 URL）、`photos[]`；photos[] 字段表逐字：

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `id` | string | 否 | 唯一标识符，不设置会自动生成 |
| `src` | string | **是** | 图片链接地址 |
| `thumbnail` | string | 否 | 缩略图链接 |
| `alt` | string | 否 | 替代文本 |
| `title` | string | 否 | 图片标题 |
| `description` | string | 否 | 图片描述 |
| `tags` | array | 否 | 图片标签 |
| `date` | string | 否 | 拍摄日期 |
| `location` | string | 否 | 拍摄地点 |
| `width`/`height` | number | 否 | 图片尺寸 |
| `camera` | string | 否 | 相机型号 |
| `lens` | string | 否 | 镜头信息 |
| `settings` | object | 否 | 拍摄参数 |

- §隐藏功能：「在任何模式的 `info.json` 中添加 `"hidden": true` 即可隐藏相册」「不是真正的访问控制」。
- §常见问题 Q1：「本地模式是否有 cover.jpg、外链模式是否设置 mode:"external"」；Q5 迁移：「移除 `mode: "external"`、确保有 `cover.jpg` 文件」。

## 3. press-file.md（单文件方案文章）

- §创建文章：「在 `src/content/posts` 目录下创建一个新的 Markdown 文件」「**必须包含 `title` 和 `description` 字段**」。
- §Frontmatter 字段详解逐字分类：
  - 必需字段：`title`（必需）、`description`（必需）；
  - 发布相关：`published`（YYYY-MM-DD）、`pubDate`（与 published 类似）、`date`（可选，不提供时系统使用文件的创建日期）、`draft`、`permalink`（固定链接）；
  - 内容分类：`tags`（数组）、`category`、`pinned`；
  - 作者信息：`author`、`licenseName`（如 "MIT"、"CC BY 4.0"）、`sourceLink`；
  - 图片设置：`image`（文章封面图片）。
- §示例 frontmatter 全字段（12 个）：`title, published, pinned, description, tags, category, licenseName, author, sourceLink, draft, date, image, pubDate, permalink`（示例含 14 键）。
- §添加图片：「图片文件放在 `public` 目录下，然后……`![图片描述](/images/my-image.webp)`」；「文件名将被用作文章的 URL 路径，所以应该具有描述性且**不含特殊字符**」。
- §开头注记：「单文件方案会导致 RSS 无法正常构建图片的路径（指本地……），如果需要使用 RSS 功能请使用文件夹写作方案。」

## 4. press-folder.md（文件夹方案文章·推荐）

- §创建文章：「在 `src/content/posts` 目录下创建一个新的**文件夹**……名为 `index.md` 的文件」「**必须包含 `title` 和 `description` 字段**」。
- §图片设置：「**图片路径最佳实践：在子文件夹方法中，推荐使用相对路径引用图片 `image: './cover.jpg'`。**」
- §管理图片和其他资源（无需图床方案）：目录示例 `src/content/posts/my-complex-post/{index.md, image1.png, image2.jpg, data.json}`；「在文章中引用图片时，可以直接使用相对路径：`![图片描述](image1.png)`」「**重要提示：** 像这样直接填写文件的名字，这样才能让 RSS 正常构建图片的路径，同时确保图片与文章一同打包部署。」
- §图片优化建议目录结构：可建 `images/`、`assets/` 子目录；「对于图片较多的文章，可以创建子目录进一步组织资源」。
- §预览文章：「将文件夹名拼接到预览 URL 末尾即可查看（如 `http://localhost:4321/posts/my-complex-post`）」。
- §创建多篇文章：「`src/content/posts/` 下创建多个文件夹，每个文件夹代表一篇文章（含 index.md 与资源）」。

## 5. press-permalink.md（固定链接）

- 「在文章的 Front Matter 中添加……`permalink: "encrypted-example"`」「他会相对于 `posts` 构建路径生成一个固定链接，例如：`https://mizuki.site/posts/encrypted-example`」。

## 6. press-image.md（图片语法）

- Mizuki 8.0+ 特性：`![图片描述 w-50%](图片链接 "图片标题")`——`w-50%` 缩放百分比 + 可选标题（语法扩展，Server 的 markdown 处理按原样保留即可）。

## 7. special-timeline.md（时间线）

- §2 interface 原文：

```ts
export interface TimelineItem {
  id: string;
  title: string;
  description: string;
  type: "education" | "work" | "project" | "achievement";
  startDate: string;
  endDate?: string;
  location?: string;
  organization?: string;
  position?: string;
  skills?: string[];
  achievements?: string[];
  links?: {
    name: string;
    url: string;
    type: "website" | "certificate" | "project" | "other";
  }[];
  icon?: string;
  color?: string;
  featured?: boolean;
}
```

- §2 字段说明要点：「`description: string`: (必填)」「`type`: (必填) `"education" | "work" | "project" | "achievement"`」「`endDate?: string`: (可选) 结束日期；进行中事件可省略」「`position?: string`」「`achievements?: string[]`」「`links?: {...}[]`（type 为 `"website" | "certificate" | "project" | "other"`）」「`icon?: string`: (可选) 事件图标名称，**使用 Iconify 图标集**」「`color?: string`: (可选) 主题颜色，**十六进制格式**」。
- §2 示例（education 逐字）：`icon: "material-symbols:school"`, `color: "#059669"`；§3 示例（work）：`icon: "material-symbols:work"`, `color: "#DC2626"`。
- §5 事件类型语义：education（organization/location/achievements）、work（organization/location/position）、project（skills/achievements/links）、achievement（证书/奖项/比赛成果；organization/location/links）。
- §6 最佳实践：日期 "YYYY-MM-DD"；「ID 管理：使用事件名称的小写和连字符形式」。

## 8. special-diary.md（日记）

- §2 interface 原文：

```ts
export interface DiaryItem {
  id: number;
  content: string;
  date: string;
  images?: string[];
  location?: string;
  mood?: string;
  tags?: string[];
}
```

- §2 字段说明：「`id: number`: (必填)……**必须是数字，且不能重复**。通常按时间顺序递增」「`content: string`: (必填)」「`date: string`: (必填)……**必须是 ISO 8601 格式**的字符串，例如 `2025-01-15T10:30:00Z`」「`images?: string[]`（可选）」；location/mood/tags 可选。
- §3 图片路径约定：「将图片文件复制到项目的 `public` 目录下，建议 `public/images/diary/`」「**路径是从 `public` 文件夹开始计算的**：放在 `public/images/diary/` 下，路径就是 `/images/diary/my-new-photo.webp`」。

## 9. special-projects.md（项目）

- §2 interface 原文要点（必填面）：`id, title, description, image, category, techStack, status, startDate` 必填；`liveDemo, sourceCode, endDate, featured, tags, visitUrl` 可选。枚举：「`category`: (必填) `"web" | "mobile" | "desktop" | "other"`」「`status`: (必填) `"completed" | "in-progress" | "planned"`」。
- §2 其他：「`image: string`: (必填) 展示图片路径，通常放在 `public/images/projects/` 目录下」「`techStack: string[]`: (必填)」「`startDate: string`: (必填) 开始日期 "YYYY-MM-DD"」；示例中 `image: ""`（空串合法）。
- §5 状态管理：completed「应该有 `endDate`」；in-progress/planned「不需要 `endDate`」。
- §6 分类语义：web（网站/Web应用/管理后台）、mobile、desktop、other。

## 10. special-skills.md（技能）

- §2 interface 原文要点：`id, name, description, icon, category, level, experience` 必填；`projects, certifications, color` 可选。枚举与类型：「`category`: (必填) `"frontend" | "backend" | "database" | "tools" | "other"`」「`level`: (必填) `"beginner" | "intermediate" | "advanced" | "expert"`（字符串枚举，非数字）」「`icon: string`: (必填)……**使用 Iconify 图标集**」「`experience`: (必填) `{ years: number, months: number }`」。

## 11. special-devices.md（设备）

- §2 interface 原文：「`interface Device`（每一设备必填字段全部为 string）：`name, image, specs, description, link` 全部必填」；「`DeviceCategory`：键名是分类名称（如 "OnePlus"、"Router"），值是该分类下的设备数组；可有 "自定义" 分类」「分类显示顺序按对象属性顺序」。
- §2 图片路径：「`image: string`: (必填) 设备图片路径，通常放在 `public/images/device/` 目录下」。

## 12. special-about.md（关于页）

- 「关于页面的内容位于 `src/content/spec/about.md` 文件中」「支持标准 Markdown 语法以及 Mizuki 主题扩展的语法」（`::github{repo=...}`、`> [!NOTE]` 注意框、LaTeX）。

## 13. other-structure.md（内容仓库结构）

- §推荐的目录结构：内容仓库 `Mizuki-Content/{posts/, spec/, data/, images/{albums,diary,posts}}`；data/ 含 `anime.ts, projects.ts, skills.ts, timeline.ts, friends.ts, diary.ts, devices.ts`。
- §连接到 Mizuki 代码仓库：方式一 Git Submodule（`git submodule add <repo> content`）；方式二独立仓库模式（`.env` `CONTENT_REPO_URL`/`CONTENT_DIR=./content`/`USE_SUBMODULE=false` + `pnpm run sync-content`）。
- §图片引用：「相对路径 (推荐)：`![描述](./image.jpg)`」「公共图片目录：`![描述](/images/posts/image.jpg)`」。
- §数据文件说明：新增 `anime.ts`（番剧数据，六类集合之外的第 7 个数据文件）。

## 14. other-separation.md（内容分离）

- §快速开始：「本地模式（最简单）**不需要任何配置**，内容存放在 `src/content/` 和 `public/images/` 目录」；进阶：`ENABLE_CONTENT_SYNC=true` + `CONTENT_REPO_URL`。
- §常用命令：`init-content` / `sync-content` / `check-env`；「`pnpm dev` 和 `pnpm build` 会自动同步内容；同步失败不会中断开发/构建……（回退到本地内容）」。

## 15. other-auto.md（自动构建）

- Repository Dispatch 方案：内容仓库推送 → `repository_dispatch: types: [content-updated]` 触发代码仓库部署（属博客前端 CI 面，Server 无直接义务）。

---

## 未快照页面说明

导航中其余页面（安装、部署、配置项 `src/config.ts`、markdown.excerpt、轻笑/SEO 等）与本批审计的「数据规格」无直接交集或已由上列页面覆盖；如后续需要，按 README.md 快照清单流程补抓。详见 `docs/refs/mizuki-docs/README.md`。
