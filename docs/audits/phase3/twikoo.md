# 官方文档快照：Twikoo 评论（Article-layout/Twikoo）

- 来源 URL：`https://docs.mizuki.mysqil.com/Article-layout/Twikoo/`
- 快照内容由架构师 2026-08-28 抓取，执行会话无网，以本文件为准。

## 配置位置

主题 `src/config.ts` 的 `commentConfig` 对象，结构（verbatim）：

```ts
export const commentConfig: CommentConfig = {
  enable: false, // 全局开关
  system: "twikoo", // "twikoo" | "giscus"
  twikoo: { envId: "`https://twikoo.vercel.app`", lang: SITE_LANG },
  giscus: { repo, repoId, category, categoryId, mapping: "pathname",
    strict: "0", reactionsEnabled: "1", emitMetadata: "0",
    inputPosition: "top", theme: "preferred_color_scheme", lang: SITE_LANG, loading: "lazy" },
};
```

## 关键语义

- `twikoo.envId` = 自部署服务地址（官方演示地址 `https://twikoo.vercel.app` 禁生产用）；
- 数据持久化需自配 MongoDB / MySQL / PostgreSQL；
- 审核与垃圾过滤在 Twikoo 自身管理后台（`<envId>/admin`）。

## 文章级开关

- frontmatter `comment: false` 强制禁用当前文章评论；
- 未设置 = true（继承全局）；
- 显示逻辑 = 全局 `enable` && 文章未显式禁用。
