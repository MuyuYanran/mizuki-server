# 测试夹具：假 Mizuki 项目（P3 定型）

仓库内置假 Mizuki 项目，满足 MASTER-PLAN §4.3 四项检测规则（astro 依赖、
astro.config.mjs、src/data/、src/content/posts/）。P3 数据文件引擎的
golden-file 测试以此为唯一数据源；**测试对 fixture 的写操作一律作用于
临时副本**（复制到 os.tmpdir 后再操作），严禁改写本目录内文件。

六个数据文件刻意覆盖的解析难点：

| 文件 | 覆盖点 |
|---|---|
| diary.ts | 块注释/行注释（数据块内外）、单引号、尾随逗号、字符串含引号与换行 |
| friends.ts | `as const`、interface 定义、文件尾代码 |
| projects.ts | `satisfies`、布尔值、可选字段缺省 |
| timeline.ts | 无插值模板字符串（多行内容）、union 类型注解 |
| skills.ts | 嵌套对象（experience）、数字与前缀负号 |
| devices.ts | grouped 对象结构 `{分类: Device[]}`、中文字符串键、空分组注释 |

类型定义集中在 `src/types.ts`（数据文件 import type 引用——写回引擎
只替换初始化表达式区域，import 与类型定义逐字节不动）。
