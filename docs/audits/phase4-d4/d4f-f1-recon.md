# D4f F1 现状侦查留档（禁臆断 · 证据为现行分支逐字摘录）

- [侦查时点] 2026-09-11，HEAD = `fcb06bb`（fix(web/init-wizard) W4-A，工作树净态）
- [侦查对象] `apps/server/src/modules/posts/posts.service.ts`（现行 createPost / deletePost / uploadCover）、
  `CreatePostBodySchema`、面板 `PostListPage.vue` / `PostEditPage.vue` 删除与封面守卫
- [方法] 逐字符读现行源码 + 本文件摘录（非臆断、非记忆重构）

## 1. createPost 现行分支（结论：仅目录形态）

- `CreatePostBodySchema`（现行）：

```ts
export const CreatePostBodySchema = z.object({
  slug: PostSlugSchema,
  frontmatter: PostFrontmatterSchema,
  content: z.string(),
});
```

→ **无 `form` 字段**，请求体无法表达形态。

- `createPost` 落盘段（现行，仅目录形态）：

```ts
fs.mkdirSync(dirAbs, { recursive: true });
const fileAbs = this.postFileAbs(slug);            // posts/<slug>/index.md
const text = stringifyPostMarkdown(frontmatter, body.content);
await this.backup.preWriteBackup(fileAbs, `post create: ${slug}`);
this.atomicWrite(fileAbs, text);
```

- slug 冲突检测（现行，**双向已在位**——目录/文件形态先各查一次）：

```ts
const dirAbs = this.postDirAbs(slug);
if (fs.existsSync(dirAbs)) {
  throw new ConflictException(`文章已存在：${slug}`);
}
const fileFormAbs = this.postFileFormAbs(slug);
if (fs.existsSync(fileFormAbs)) {
  throw new ConflictException(`文章已存在（文件形态）：${slug}`);
}
```

→ F2 的「slug 冲突双向检测」在现行代码已存在（B2 批遗留成果）；file 分支可直接复用，
差异仅在「file 分支也须先过这两查」（URL 命名空间共享，任一形态占用均 409）。

## 2. deletePost 现行拒绝点（结论：file-form 400，即 D4c/C2 遗留「规则③」）

```ts
const existing = this.readPostOrThrow(slug);
if (existing.form === 'file') {
  throw new BadRequestException(
    `文件形态文章不支持经 API 删除：${slug}（请在文件系统删除源文件 ${existing.relPath}）`,
  );
}
```

- 面板同构守卫（PostListPage.vue）：
  - `onDelete` 入口 `if (row.source === 'file') { ElMessage.warning(FILE_FORM_HINT); return; }`
  - 删除按钮 `:disabled="row.source === 'file'"` + `:title` 提示
  - 「文件」徽标 `<el-tag v-if="row.source === 'file'">文件</el-tag>`（保留项）
- e2e 既有锚：`p5-posts.e2e-spec.ts` C2-②（删除 400 + 零副作用）——随 F3 解除须翻写。

## 3. uploadCover 现行拒绝点（F4 维持 400，仅改文案）

```ts
if (existing.form === 'file') {
  throw new BadRequestException(
    `文件形态文章不支持封面上传：${slug}（无目录可存放 cover.jpg，请在源文件 frontmatter.image 直接引用图片路径）`,
  );
}
```

- 面板：编辑页封面上传按钮 `v-if="isEdit && !isFileForm"`（简单隐藏）；FILE_FORM_HINT 旧文案
  =「文件形态文章不支持封面上传（无目录可存放 cover.jpg）……」——F4 改为同文案指引。

## 4. 判读结论（F2~F5 实施面）

| 项 | 现状 | D4f 目标 |
|---|---|---|
| 创建 | 仅目录形态；冲突双向检测已在位 | 增 `form`('dir' 缺省/'file')；file 走 `posts/<slug>.md` 同管线 |
| 删除 | file-form 400 指引 | supersede：单文件备份 + unlink，backupIds 语义同目录删除 |
| 封面 | 400（旧文案） | 维持 400，文案改「单文件文章无同目录，请在 image 字段填写 public 路径或外链」 |
| 面板 | delete 禁用 + 封面隐藏 | 撤 delete 守卫（徽标保留）；封面区块显指引文案；编辑页灰字图片指引 |
