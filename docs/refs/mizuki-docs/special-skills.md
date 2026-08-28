> 快照说明：抓取自 https://docs.mizuki.mysqil.com/special/skills/ ，快照日期 2026-08-28，文档日期 2025-11-20。仅供 B4 审计引用。

# 技能页面

## 1. 核心概念：页面与数据分离

- 展示逻辑：`src/pages/skills.astro`
- 内容数据：`src/data/skills.ts` —— 每一个技能都是一个对象，包含 `id`, `name`, `description`, `level` 等属性。

## 2. `src/data/skills.ts` 文件详解

```ts
export interface Skill {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: "frontend" | "backend" | "database" | "tools" | "other";
  level: "beginner" | "intermediate" | "advanced" | "expert";
  experience: {
    years: number;
    months: number;
  };
  projects?: string[];
  certifications?: string[];
  color?: string;
}

export const skillsData: Skill[] = [
  {
    id: "javascript",
    name: "JavaScript",
    description: "Modern JavaScript development, including ES6+ syntax, asynchronous programming, and modular development.",
    icon: "logos:javascript",
    category: "frontend",
    level: "advanced",
    experience: { years: 3, months: 6 },
    projects: ["mizuki-blog", "portfolio-website", "data-visualization-tool"],
    color: "#F7DF1E",
  },
];
```

**数据结构说明**（interface Skill）：

- `id: string`: (必填) 唯一标识符，通常是技能名称的小写形式。
- `name: string`: (必填) 显示名称。
- `description: string`: (必填) 详细描述，说明掌握程度和应用场景。
- `icon: string`: (必填) 图标名称，**使用 Iconify 图标集**。
- `category`: (必填) `"frontend" | "backend" | "database" | "tools" | "other"`。
- `level`: (必填) `"beginner" | "intermediate" | "advanced" | "expert"`。
- `experience`: (必填) `{ years: number, months: number }`，技能经验年数和月数。
- `projects?: string[]`: (可选) 相关项目的 ID 列表。
- `certifications?: string[]`: (可选) 相关证书列表。
- `color?: string`: (可选) 技能卡片主题颜色，十六进制格式。

## 5. 技能水平说明

"beginner"初级 / "intermediate"中级 / "advanced"高级 / "expert"专家级。

## 6. 技能分类

"frontend"前端技术 / "backend"后端技术 / "database"数据库技术 / "tools"开发工具 / "other"其他技能。

## 7. 最佳实践

图标使用官方或广泛认可的图标；同一类别的技能使用协调的颜色方案；项目关联实际项目 ID。

---

版权归属：LyraVoid Team ｜ 许可证：CC-BY-4.0 ｜ 最后更新于: 4/21/26, 10:12 PM
