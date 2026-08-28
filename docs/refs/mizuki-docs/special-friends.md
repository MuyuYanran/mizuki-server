> 快照说明：抓取自 https://docs.mizuki.mysqil.com/special/friends/ ，快照日期 2026-08-28，文档日期 2025-08-17。仅供 B4 审计引用。

# 友链页面

## 友链页面配置教程

Mizuki 主题内置了一个美观的友情链接（Friends）页面，用于展示与您的博客相关的其他网站或朋友的博客链接。与传统博客文章不同，友情链接更侧重于快速访问和分类管理。

### 1. 核心概念：页面与数据分离

```
Mizuki
├── src
│   ├── pages
│   │   └── friends.astro
│   ├── data
│   │   └── friends.ts
```

- **展示逻辑**: `src/pages/friends.astro` —— 定义布局/交互，通常不需要修改。
- **内容数据**: `src/data/friends.ts` —— 友情链接内容的"数据库"，所有链接以数组形式存储。每一个友情链接都是一个对象，包含 `id`, `title`, `imgurl`, `desc`, `siteurl` 和 `tags` 等属性。

### 2. `src/data/friends.ts` 文件详解

```ts
export interface FriendItem {
  id: number;
  title: string;
  imgurl: string;
  desc: string;
  siteurl: string;
  tags: string[];
}

export const friendsData: FriendItem[] = [
  {
    id: 1,
    title: "Astro",
    imgurl: "https://avatars.githubusercontent.com/u/44914786?v=4&s=640",
    desc: "The web framework for content-driven websites",
    siteurl: "https://github.com/withastro/astro",
    tags: ["Framework"],
  },
];
```

**数据结构说明**（interface FriendItem）：

- `id: number`: (必填) 友情链接的唯一标识符。**必须是数字，且不能重复**。通常按添加顺序递增。
- `title: string`: (必填) 网站或博客的名称。
- `imgurl: string`: (必填) 网站头像或Logo的URL地址。建议使用正方形图片，尺寸为640x640像素。
- `desc: string`: (必填) 网站的简短描述。
- `siteurl: string`: (必填) 网站的URL地址，需要包含协议（http://或https://）。
- `tags: string[]`: (必填) 标签数组，用于分类。**至少包含一个标签**。

- 数组中每一个对象都遵循 FriendItem 接口定义；显示顺序通常按数组顺序，可用随机排序函数随机展示。

### 3. 添加一个新的友情链接

- `id` 给一个新的、唯一的数字（例如在最后一个友情链接的 id 基础上加 1）。
- `desc` 建议控制在 50 个字符以内。
- `tags` 添加适当的标签，**至少一个**。

### 4. 修改或删除友情链接

- 修改：直接在数组中找到对象修改 `title`, `imgurl`, `desc`, `siteurl` 或 `tags` 属性。
- 删除：将对象从数组完全移除。

### 5. 高级功能：随机排序

```ts
export function getShuffledFriendsList(): FriendItem[] {
  const shuffled = [...friendsData];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
```

### 6. 最佳实践与建议

- 头像图片：正方形高质量图片，640x640 像素。
- 描述长度：简洁，建议 50 字符以内。
- 标签管理：一致的标签命名，建议英文标签，如 "Framework"、"Docs"。
- 链接有效性：定期检查并移除失效链接。
- ID 管理：保持 id 的连续性和唯一性。

### 7. 页面特性与自定义

- 响应式设计：桌面端 2 列网格布局，移动端 1 列布局。
- 标签显示：每个链接可显示相关标签。
- 悬停效果、随机排序。

### 8. 导航栏配置

`src/config.ts` 的 `navBarConfig` 中包含友情链接（`LinkPreset.Friends` 或手动 `{ name, url: "/friends/", icon }`）。

### 9. 友情链接申请

可创建申请页面收集信息，定期审核后将符合条件的网站添加到 `friendsData`。

---

版权归属：LyraVoid Team ｜ 许可证：CC-BY-4.0 ｜ 最后更新于: 4/21/26, 10:12 PM
