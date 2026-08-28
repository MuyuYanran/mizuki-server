> 快照说明：抓取自 https://docs.mizuki.mysqil.com/special/about/ ，快照日期 2026-08-28，文档日期 2025-08-17。仅供 B4 审计引用。

# 自定义页面（关于页面）

关于页面内容存储在 Markdown 文件中：

```
Mizuki
├── src
│   ├── pages
│   │   └── about.astro
│   ├── content
│   │   └── spec
│   │       └── about.md
```

- 关于页面的内容位于 `src/content/spec/about.md` 文件中。该文件使用 Markdown 格式编写，支持标准 Markdown 语法以及 Mizuki 主题扩展的语法。
- 修改内容：直接编辑该文件，保存后重启开发服务器即可。
- 支持的 Markdown 扩展语法：`::github{repo="用户名/仓库名"}` GitHub 卡片；`> [!NOTE]`、`> [!TIP]`、`> [!WARNING]` 注意框；`$inline$` / `$$block$$` LaTeX 数学公式。
- 页面样式由 `src/pages/about.astro` 控制，通常不需要修改。

---

版权归属：LyraVoid Team ｜ 许可证：CC-BY-4.0 ｜ 最后更新于: 4/21/26, 10:12 PM
