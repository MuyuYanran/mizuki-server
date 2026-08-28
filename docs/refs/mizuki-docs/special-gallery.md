> 快照说明：抓取自 https://docs.mizuki.mysqil.com/special/gallery/ ，快照日期 2026-08-28，文档日期 2025-08-28。仅供 B4 审计引用。

# 相册页面

## 系统概述

相册系统支持两种存储模式和灵活的显示控制：

- **本地模式**：图片存储在服务器本地文件系统
- **外链模式**：图片通过外部链接引用

核心功能：自动扫描和生成相册；支持多种布局（网格/瀑布流）；相册隐藏/显示控制；标签和元数据管理；响应式设计。

## 相册模式对比

| 特性 | 本地模式 | 外链模式 |
|---|---|---|
| 图片存储 | 本地文件系统 | 外部链接 |
| 加载速度 | 快速 | 取决于外部服务 |
| 存储成本 | 占用服务器空间 | 无本地存储成本 |
| 稳定性 | 高 | 取决于外部服务 |
| 配置复杂度 | 简单 | 中等 |
| 适用场景 | 个人网站、小型项目 | 大量图片、CDN优化 |

## 基础配置

每个相册都需要一个 `info.json` 配置文件，位于相册文件夹内。

### 基本结构

```
public/images/albums
├── 相册名称1/
│   ├── info.json    # 必需：相册配置
│   ├── cover.jpg    # 本地模式必需：封面图
│   ├── photo1.jpg   # 本地模式：相册图片
│   └── photo2.png
└── 相册名称2/
    └── info.json    # 外链模式只需配置文件
```

### 通用字段说明（info.json）

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

## 本地模式详解

### 文件结构

```
相册文件夹/
├── info.json   # 配置文件
├── cover.jpg   # 封面图（必需）
├── 图片1.jpg
├── 图片2.png
└── 图片3.gif
```

### 配置示例

```json
{
  "title": "我的旅行相册",
  "description": "2024年夏天的美好回忆",
  "date": "2024-08-15",
  "location": "日本京都",
  "tags": ["旅行", "京都", "夏天"],
  "layout": "masonry",
  "columns": 3
}
```

### 支持的图片格式

- `.jpg` / `.jpeg`
- `.png`
- `.gif`
- `.webp`
- `.svg`
- `.avif`
- `.bmp`
- `.tiff` / `.tif`

### 文件命名规则

- **封面图必须命名为 `cover.jpg`**
- 其他图片可以任意命名
- 支持中文文件名
- 建议使用有意义的文件名

### 自动功能

- 系统会自动扫描文件夹内的所有图片
- 自动生成图片ID和基本信息
- 自动获取文件修改时间作为拍摄日期

## 外链模式详解

外链模式需要在 `info.json` 中完整定义所有图片信息。

### 基本配置

```json
{
  "mode": "external",
  "title": "外链相册示例",
  "cover": "https://example.com/cover.jpg",
  "photos": [
    { "src": "https://example.com/photo1.jpg", "alt": "图片描述" }
  ]
}
```

### 完整配置示例

```json
{
  "mode": "external",
  "title": "风景摄影集",
  "description": "来自世界各地的美丽风景",
  "date": "2024-08-20",
  "location": "全球",
  "tags": ["风景", "摄影", "自然"],
  "layout": "masonry",
  "columns": 3,
  "cover": "https://cdn.example.com/albums/landscape/cover.jpg",
  "photos": [
    {
      "id": "mountain-sunset",
      "src": "https://cdn.example.com/photos/mountain-sunset.jpg",
      "thumbnail": "https://cdn.example.com/thumbs/mountain-sunset.jpg",
      "alt": "山顶日落",
      "title": "阿尔卑斯山日落",
      "description": "在阿尔卑斯山顶拍摄的壮丽日落景象",
      "tags": ["山脉", "日落", "阿尔卑斯"],
      "date": "2024-07-15",
      "location": "瑞士阿尔卑斯山",
      "width": 1920,
      "height": 1080,
      "camera": "Canon EOS R5",
      "lens": "RF 24-70mm f/2.8L IS USM",
      "settings": { "aperture": "f/8", "shutter": "1/125", "iso": "200", "focal": "35mm" }
    },
    {
      "id": "ocean-waves",
      "src": "https://cdn.example.com/photos/ocean-waves.jpg",
      "alt": "海浪",
      "title": "太平洋海浪",
      "tags": ["海洋", "海浪"],
      "width": 1920,
      "height": 1280
    }
  ]
}
```

### 照片字段说明（photos[]）

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

### 外链服务推荐

免费服务：Imgur、Cloudinary（免费额度）；付费CDN：阿里云OSS、腾讯云COS、AWS S3；图床：SM.MS、路过图床；GitHub 可用作图床。

## 隐藏功能

在任何模式的 `info.json` 中添加 `"hidden": true` 即可隐藏相册：

- ✅ 相册不会出现在相册列表页面
- ✅ 文件仍然保留在服务器上
- ✅ 知道直接链接仍可访问
- ❌ 不是真正的访问控制

使用场景：临时隐藏、私人内容、测试相册、未完成相册、季节性展示。

## 完整配置示例

示例1（本地模式 grid 4 列）、示例2（外链模式 masonry）、示例3（隐藏的外链相册，`hidden: true` + `cover` 指向 picsum）——见上文各节示例。

## 最佳实践（节选）

- 文件组织：使用「日期+描述」命名相册文件夹。
- 建议尺寸：封面图 800x600，相册图片不超过 2000px。
- 布局选择：Grid 适合尺寸相近图片；Masonry 适合尺寸差异大；列数手机 1-2 列、桌面 3-4 列。

## 常见问题（节选）

- Q1 相册不显示：检查 info.json 格式、本地模式是否有 cover.jpg、外链模式是否设置 mode:"external"、hidden 是否为 true、路径。
- Q5 迁移（外链→本地）：下载所有外链图片、移除 `mode: "external"`、确保有 `cover.jpg` 文件。
- Q6 安全：`hidden` 只是隐藏显示，不是访问控制。

---

版权归属：LyraVoid Team ｜ 许可证：CC-BY-4.0 ｜ 最后更新于: 4/21/26, 10:12 PM
