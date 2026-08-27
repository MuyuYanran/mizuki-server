# 任务：二期 B1 —— 视觉主题与交互打磨（纯前端）

## 0. 任务定位
你是 Mizuki-Server 项目实施 AI，连续执行模式。本期为二期第一批（B1），范围
一句话：完成 REQUIREMENTS-PHASE2 中 R2-1/3/4/5/9/12/13 及 R2-6/8 的前端部分
——主题系统、向导修复、菜单过滤、裁切、灯箱、日期选择器、字段提示。
R2-2 的目录浏览 UI 属 B2（后端先行），本阶段不做。

## 1. 上下文注入
1. docs/REQUIREMENTS-PHASE2.md：上述 R2 条目全文（唯一规格来源）
2. CHANGELOG.md 与 docs/SESSIONS.md 最后一份交付报告（P11）：已知坑清单
   （尤其「views 子目录相对路径层级」「构建需清洁环境」两条）
3. 相关现存文件：apps/web/src/lib/schema-form/{mapper.ts,SchemaForm.vue}、
   src/views/collections/CollectionListPage.vue、
   src/views/albums/AlbumDetailPage.vue、src/layouts/MainLayout.vue、
   src/router/index.ts、src/stores/auth.ts
4. packages/shared/src/collections/*.ts（schema 现 strait，本阶段可为其补
   description 元数据）

## 2. 实现文件清单
新建：src/styles/theme.css（调色板变量集中处）、
      src/components/CropperUploader.vue、
      src/components/FieldHint.vue（问号 tooltip 封装）
修改：main.ts/App.vue（dark class 初始化与监听）、MainLayout.vue（顶栏切换
按钮 + 按状态接口的 mode 过滤菜单）、InitWizardView.vue（R2-3/4 样式修复）、
mapper.ts（ZodDate/日期串分支 + description 渲染钩子）、SchemaForm.vue
（FieldHint 接入）、AlbumDetailPage.vue（v-viewer 灯箱 + 分页）、
CollectionListPage.vue（友链条目接 CropperUploader）、
router/index.ts（mode 过滤的重定向守卫）、vite 配置如需。
allowed 新依赖：vue-cropper、v-viewer。

## 3. 详细规格
按 R2 条目执行；补充四点：
- 主题切换按钮三态循环：浅色→深色→跟随 system；
- SchemaForm description 双消费：必填问号 tooltip + 字段下方灰字说明二者
  都渲染（信息不重复措辞）；
- mode 过滤的判定源优先 /admin/system/status 的 mode 字段；请求失败或字段
  缺失 → 显示全部（fail-open），不得抛错阻塞登录；
- 控制台皮肤：LogTerminal 文字颜色分级映射（stdout 默认灰白 / stderr 淡红 /
  exit 事件高亮），暗色模式终端底色 #0d1117 类深色基调，避免刺眼纯黑；
  随 R2-1 统一走变量。

## 4. 接线
不改任何后端文件。所有新依赖版本记入 ADR-001 二期追加段。

## 5. 禁止事项
继承一期七条（git 边界为允许 add/commit）。专属：不得触碰 apps/server/**；
不得变更已冻结公开 API 的调用方式；TipTap 编辑器一行不动。

## 6. 验收
pnpm -r build && pnpm lint && pnpm test 全绿（test 数 240 不得减少）。随后：
1. dark/light 往返截图记录于报告（供人工核对观感）；
2. 步骤条四步全显不换行（窄窗口 1280px 下断言 offsetWidth 内无换行可用
   scrollHeight 对比法或人工核验入清单）；
3. 运行模式选项视觉对齐（人工核验入清单）；
4. schema 含 description 的字段渲染 tooltip；必填图标悬停出现移开消失
   （人工核验）；
5. 友链头像裁切全流程可用（人工核验）；
6. 相册网格点图开灯箱、Esc 关闭、左右切换（人工核验）；
7. 日期字段弹日历选择、默认值为当天、保存往返一致（人工核验 + 既有 e2e 回归）；
8. minimal 模式下富文本与集合菜单消失、直接敲路由被重定向（人工核验）；
9. 回归：240 后端用例全绿不受影响。
10. 控制台页明暗两种观感截图入报告（终端底色、各级日志着色、滚动条）。

## 7. 交付报告
文件清单、依赖版本、devtools 截图说明、疑问清单、CHANGELOG 与 SESSIONS
追加「Phase2-B1」条目。人工核验项单独汇总为《B1 手动走查清单》。

## 8. 冲突处理
同一期八条：停下、≤2 候选、保守解释歧义并记报告。
