> 快照说明：抓取自 https://docs.mizuki.mysqil.com/special/timeline/ ，快照日期 2026-08-28，文档日期 2025-11-20。仅供 B4 审计引用。

# 时间线页面

## 1. 核心概念：页面与数据分离

- 展示逻辑：`src/pages/timeline.astro`
- 内容数据：`src/data/timeline.ts` —— 每一个事件都是一个对象，包含 `id`, `title`, `description`, `type` 等属性。

## 2. `src/data/timeline.ts` 文件详解

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

export const timelineData: TimelineItem[] = [
  {
    id: "current-study",
    title: "Studying Computer Science and Technology",
    description: "Currently studying Computer Science and Technology, focusing on web development and software engineering.",
    type: "education",
    startDate: "2022-09-01",
    location: "Beijing",
    organization: "Beijing Institute of Technology",
    skills: ["Java", "Python", "JavaScript", "HTML/CSS", "MySQL"],
    achievements: [
      "Current GPA: 3.6/4.0",
      "Completed data structures and algorithms course project",
    ],
    icon: "material-symbols:school",
    color: "#059669",
    featured: true,
  },
];
```

**数据结构说明**（interface TimelineItem）：

- `id: string`: (必填) 唯一标识符，通常是字符串格式的名称。
- `title: string`: (必填) 事件标题。
- `description: string`: (必填) 事件详细描述。
- `type`: (必填) `"education" | "work" | "project" | "achievement"`。
- `startDate: string`: (必填) 开始日期，"YYYY-MM-DD"。
- `endDate?: string`: (可选) 结束日期；进行中事件可省略。
- `location?: string`: (可选) 地点。
- `organization?: string`: (可选) 组织/机构名称。
- `position?: string`: (可选) 职位或角色。
- `skills?: string[]`: (可选) 相关技能列表。
- `achievements?: string[]`: (可选) 成就或成果列表。
- `links?: {...}[]`: (可选) 链接数组，每项含 `name`, `url`, `type`（type 为 `"website" | "certificate" | "project" | "other"`）。
- `icon?: string`: (可选) 事件图标名称，**使用 Iconify 图标集**。
- `color?: string`: (可选) 主题颜色，**十六进制格式**。
- `featured?: boolean`: (可选) 是否特色事件，优先展示。

## 3. 添加事件示例

工作经历示例（work）：`icon: "material-symbols:work"`, `color: "#DC2626"`, `featured: true`。

## 5. 时间线事件类型

- "education"：学校教育、在线课程、培训等；常用字段 organization, location, achievements。
- "work"：全职、实习、兼职等；常用字段 organization, location, position。
- "project"：个人/团队项目、开源贡献等；常用字段 skills, achievements, links。
- "achievement"：证书、奖项、比赛成果等；常用字段 organization, location, links。

## 6. 最佳实践与建议

- 日期格式：严格遵守 "YYYY-MM-DD"。
- ID 管理：使用事件名称的小写和连字符形式。
- **图标和颜色：为不同类型的事件使用不同的图标和颜色，增强视觉区分度。**
- 特色事件：标记最重要的事件为特色事件，在时间线顶部优先展示。

## 7. 页面功能与特性

事件筛选（按类型）、时间排序、事件详情、技能统计、经历统计、时间线视图。

---

版权归属：LyraVoid Team ｜ 许可证：CC-BY-4.0 ｜ 最后更新于: 4/21/26, 10:12 PM
