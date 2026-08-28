> 快照说明：抓取自 https://docs.mizuki.mysqil.com/special/projects/ ，快照日期 2026-08-28，文档日期 2025-11-20。仅供 B4 审计引用。

# 项目页面

## 1. 核心概念：页面与数据分离

- 展示逻辑：`src/pages/projects.astro`
- 内容数据：`src/data/projects.ts` —— 每一个项目都是一个对象，包含 `id`, `title`, `description`, `image`, `category` 等属性。

## 2. `src/data/projects.ts` 文件详解

```ts
export interface Project {
  id: string;
  title: string;
  description: string;
  image: string;
  category: "web" | "mobile" | "desktop" | "other";
  techStack: string[];
  status: "completed" | "in-progress" | "planned";
  liveDemo?: string;
  sourceCode?: string;
  startDate: string;
  endDate?: string;
  featured?: boolean;
  tags?: string[];
  visitUrl?: string;
}

export const projectsData: Project[] = [
  {
    id: "mizuki-blog",
    title: "Mizuki Blog Theme",
    description: "Modern blog theme developed based on Astro framework, supporting multilingual, dark mode, and responsive design features.",
    image: "",
    category: "web",
    techStack: ["Astro", "TypeScript", "Tailwind CSS", "Svelte"],
    status: "completed",
    liveDemo: "https://blog.example.com",
    sourceCode: "https://github.com/example/mizuki",
    visitUrl: "https://blog.example.com",
    startDate: "2024-01-01",
    endDate: "2024-06-01",
    featured: true,
    tags: ["Blog", "Theme", "Open Source"],
  },
];
```

**数据结构说明**（interface Project）：

- `id: string`: (必填) 唯一标识符，通常字符串格式的名称。用于内部引用和过滤。
- `title: string`: (必填) 项目名称。
- `description: string`: (必填) 详细描述，可以多行文本。
- `image: string`: (必填) 展示图片路径，通常放在 `public/images/projects/` 目录下。
- `category`: (必填) `"web" | "mobile" | "desktop" | "other"`，用于筛选。
- `techStack: string[]`: (必填) 技术栈数组，如 ["React", "Node.js"]。
- `status`: (必填) `"completed" | "in-progress" | "planned"`，用于筛选。
- `liveDemo?: string`: (可选) 在线演示 URL。
- `sourceCode?: string`: (可选) 源代码仓库 URL，通常是 GitHub 链接。
- `startDate: string`: (必填) 开始日期 "YYYY-MM-DD"。
- `endDate?: string`: (可选) 结束日期；进行中项目可省略。
- `featured?: boolean`: (可选) 特色项目优先展示。
- `tags?: string[]`: (可选) 项目标签数组。
- `visitUrl?: string`: (可选) 项目访问链接，可以是演示链接或项目主页。

## 5. 项目状态管理

- "completed"：应该有 `endDate`，通常有 `liveDemo` 和 `sourceCode`。
- "in-progress"：不需要 `endDate`。
- "planned"：不需要 `endDate`，可能没有 liveDemo/sourceCode，通常只有 startDate 或连开始日期都没有。

## 6. 项目分类

"web"（网站/Web应用/管理后台）、"mobile"（iOS/Android/跨平台）、"desktop"（Windows/macOS/Linux 应用）、"other"（硬件/嵌入式/算法研究）。

## 7. 最佳实践

项目图片建议 16:9 或 4:3 宽高比；日期严格 "YYYY-MM-DD"；ID 用项目名称小写连字符形式。

---

版权归属：LyraVoid Team ｜ 许可证：CC-BY-4.0 ｜ 最后更新于: 4/21/26, 10:12 PM
