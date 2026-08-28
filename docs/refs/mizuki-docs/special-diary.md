> 快照说明：抓取自 https://docs.mizuki.mysqil.com/special/diary/ ，快照日期 2026-08-28，文档日期 2025-08-17。仅供 B4 审计引用。

# 日记页面

## 1. 核心概念：页面与数据分离

- 展示逻辑：`src/pages/diary.astro`
- 内容数据：`src/data/diary.ts` —— 每一篇日记都是一个对象，包含 `id`, `content`, `date` 和 `images` 等属性。

## 2. `src/data/diary.ts` 文件详解

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

export const diaryData: DiaryItem[] = [
  {
    id: 1,
    content: "The falling speed of cherry blossoms is five centimeters per second!",
    date: "2025-01-15T10:30:00Z",
    images: ["/images/diary/sakura.jpg", "/images/diary/1.jpg"],
  },
];
```

**数据结构说明**（interface DiaryItem）：

- `id: number`: (必填) 唯一标识符。**必须是数字，且不能重复**。通常按时间顺序递增。
- `content: string`: (必填) 日记正文。可以是纯文本，也可以包含换行符。
- `date: string`: (必填) 发布日期和时间。**必须是 ISO 8601 格式**的字符串，例如 `2025-01-15T10:30:00Z`。`Z` 表示 UTC 时间，主题会自动转换为本地时间显示。
- `images?: string[]`: (可选) 图片路径数组。没有图片可省略。
- `location?: string`: (可选)。
- `mood?: string`: (可选)。
- `tags?: string[]`: (可选)。

## 3. 添加日记（图片路径约定）

- 将图片文件复制到项目的 `public` 目录下，建议 `public/images/diary/`。
- **路径是从 `public` 文件夹开始计算的**：放在 `public/images/diary/` 下，路径就是 `/images/diary/my-new-photo.webp`。

## 5. 最佳实践与建议

- 图片优化：建议使用现代格式如 `.webp`，上传前压缩。
- 日期格式：严格遵守 ISO 8601（`YYYY-MM-DDTHH:mm:ssZ`）。
- ID 管理：保持 id 的连续性和唯一性。
- 显示顺序：按数组顺序从上到下排列。

---

版权归属：LyraVoid Team ｜ 许可证：CC-BY-4.0 ｜ 最后更新于: 4/21/26, 10:12 PM
