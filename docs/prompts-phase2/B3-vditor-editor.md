# 任务：二期 B3 —— Vditor 所见即所得与引擎切换

## 0. 任务定位
二期第三批（B1/B2 已合入）。范围一句话：完成 R2-11——引入 Vditor 作为
Markdown 文章与 about 页的默认编辑器，提供三模式编辑 + 与 CodeMirror 的
引擎切换，不影响保存链路与既有关卡。

## 1. 上下文注入
1. docs/REQUIREMENTS-PHASE2.md：R2-11 全文
2. 现存编辑器资产：src/lib/editors/{CodeMirrorEditor.vue,index.ts}、
   src/views/posts/PostEditPage.vue、src/views/posts/AboutEditPage.vue
3. SESSIONS.md P10c 报告（CodeMirror 元包陷阱 + TipTap v3 breaking changes
   ——引以为戒再犯同类错）

## 2. 实现文件清单
新建：src/lib/editors/VditorEditor.vue
修改：PostEditPage.vue、AboutEditPage.vue（引擎切换器 + 默认引擎）、
apps/web/package.json（+vditor）、ADR-001（版本记录）。
明确不动：TipTapEditor.vue、RichArticle*Page.vue、后端全部文件。

## 3. 详细规格
- VditorEditor props：modelValue(string)、placeholder、height；
  emits update:modelValue（input 事件防抖 300ms 回吐 getString()）；
- options：mode 由父级传入（wysiwyg/ir/sv），cache.enable=false，
  counter 可选启用，toolbar 按 R2 精简掉用不到的（脑图/甘特等关闭即可）；
- 编辑器内部的小模式切换（wysiwyg↔ir↔sv）使用 vditor 官方 toolbar 按钮；
  与「引擎切换」（vditor↔codemirror）是两层独立概念，UI 上分区呈现；
- 引擎切换器位置：编辑区右上角小 select；选择存
  localStorage['mizuki.editor.engine']，下次进入沿用；
- 暗/亮主题同步：watch document.documentElement.classList('dark')变化，
  动态 setTheme；主题名对应关系记报告；
- 切引擎瞬间的内容传递：旧引擎 getValue → 新引擎 setValue，禁止丢字符；
- 保存仍走既有提交函数，正文一律当下激活引擎的最终值。

## 4. 接线
vite 若需 optimizeDeps.include:['vditor']；CSS 以 import 'vditor/dist/index.css'
进入；按需关注 chunk 警告（允许本次不拆，报告记录现状即可）。

## 5. 禁止事项
继承一期七条。专属：不得碰 TipTap 线路；不得为此改动后端 markdown 读写
逻辑一个字节；不得引入 vditor 之外的编辑器依赖。

## 6. 验收
三连全绿（用例数只增不减）。随后：
1. e2e 不新增（编辑器为纯前端交互）；但既有 240+ 全部用例不得受影响；
2. 人工走查清单（《B3 手动走查清单》）：
   a. vditor 三种模式互切无布局崩坏；
   b. 引擎切换双向内容无损（长文档粘贴实验）；
   c. 保存→重读字节级一致（可用前后 hash 对比）；
   d. 暗色模式下三引擎观感正常；
   e. about 页与 markdown 文章页两处行为一致；
   f. 引擎偏好刷新后保持。

## 7. 交付报告
同前格式；《B3 手动走查清单》；CHANGELOG/SESSIONS 追加 Phase2-B3。

## 8. 冲突处理
同一期八条。若 vditor 版本与 Vue3 集成存在已知问题，查官方 issue 给出
≤2 个应对后停下等人选。
