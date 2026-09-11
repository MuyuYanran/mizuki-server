<script setup lang="ts">
/**
 * [P10c] Markdown 文章编辑页（CodeMirror 6 + frontmatter 表单 + 封面）
 * [职责] 新建/编辑 Markdown 文章：
 *   - CodeMirror 6 编辑正文（语法高亮）；
 *   - 侧栏 frontmatter 表单（§6.10 的 12 个已知字段 + [Phase3-C1] 加密与发布区块 + [Phase3-C5] lang）；
 *   - 未知 frontmatter 键原样保留（提交时以读取时的完整 frontmatter 为基础合并）；
 *   - 封面上传（POST /admin/posts/:slug/cover）；
 *   - 上传 Markdown 文件入口（读文本填入编辑器）。
 * [状态] ACTIVE
 *
 * 往返保真（§3.2）：未知 frontmatter 键不丢——编辑时 fullFm 持有读取的完整 frontmatter，
 *   表单只编辑已知字段（12 既有 + [Phase3-C1] 加密与发布 4 键），提交时
 *   { ...fullFm, ...formFm } 合并（已知字段覆盖，未知键保留；四可删键清空按 null 提交）。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { CodeMirrorEditor, VditorEditor } from '../../lib/editors';
import { markdownImageRef } from '../../lib/media-ref';
import MediaPicker, { type MediaPickResult } from '../../components/MediaPicker.vue';
import { todayString } from '../../lib/schema-form/mapper';
import { postsApi, type PostSource, type PostView } from '../../api/posts';
import { extractArticleIssues } from '../../api/articles';
import { ApiError } from '../../api/http';
import { notifyApiError } from '../../lib/notify';
import { dateOrEmpty } from '../../lib/format';

const route = useRoute();
const router = useRouter();

/** 是否编辑态（有 :slug 路由参数） */
const isEdit = computed(() => typeof route.params['slug'] === 'string' && route.params['slug'] !== '');
const editingSlug = computed(() => (isEdit.value ? String(route.params['slug']) : ''));

const loading = ref(false);
const saving = ref(false);

/** [Phase4-D4/C2] 盘上形态标志（read 投影）：'file' = 文件形态 → 编辑已解除
 * （supersede B2b 只读分派，产品裁定 2026-09-08）；仅封面上传/删除受限（服务端规则③④保留） */
const postSource = ref<PostSource | null>(null);
const isFileForm = computed(() => postSource.value === 'file');
/** 同构服务端规则④文案（封面上传限制；删除限制提示见 PostListPage） */
const FILE_FORM_HINT = '文件形态文章不支持封面上传（无目录可存放 cover.jpg），请在源文件 frontmatter.image 直接引用图片路径';

/** 正文 */
const content = ref('');
/** 读取时的完整 frontmatter（含未知键） */
const fullFm = ref<Record<string, unknown>>({});

/** 引擎偏好：vditor 默认，持久化 localStorage */
const ENGINE_KEY = 'mizuki.editor.engine';
type Engine = 'vditor' | 'codemirror';
const engine = ref<Engine>((localStorage.getItem(ENGINE_KEY) as Engine | null) ?? 'vditor');
/** [Phase4-D2] insertAtCursor 为可选能力（两引擎均已暴露；缺席时静默跳过） */
const editorRef = ref<{ getValue: () => string; insertAtCursor?: (text: string) => void } | null>(null);

/** [Phase4-D2/需求4] 编辑器图片按钮 → MediaPicker 选图后于光标处插入 Markdown 图片引用 */
const imagePickerVisible = ref(false);

function onImagesPicked(results: MediaPickResult[]): void {
  const md = results
    .map((r) => markdownImageRef(r.url, r.name !== undefined ? r.name.replace(/\.[a-zA-Z0-9]+$/, '') : ''))
    .join('\n\n');
  if (md === '') {
    return;
  }
  editorRef.value?.insertAtCursor?.(md);
}

function onEngineChange(next: Engine): void {
  // 切换前把当前引擎的最新值刷入 content，确保新引擎不丢字符
  if (editorRef.value) {
    content.value = editorRef.value.getValue();
  }
  engine.value = next;
  localStorage.setItem(ENGINE_KEY, next);
}

/**
 * 表单编辑的 16 个已知字段（11 既有 + [Phase3-C1] 加密与评论三字段 + [Phase3-C5] lang
 * + [Phase4-D4/S3/B1b] published 日期）。
 * [Phase4-D4/B1] 移除 published 布尔开关：官方语义中 published 为发布日期（YYYY-MM-DD，
 * press-file.md 快照 L40-43），布尔开关语义由 draft 承载；面板自此不再写 published
 * 布尔值。存量遗留 published:false 不可经 API 删键（不在 C1 删键集合），由服务端
 * deriveStatus 兼容分支兜底为 draft（ADR-025 全案）。
 * [Phase4-D4/S3/B1b] published 日期字段回补（官方日期语义；ADR-025 日期序列化节）：
 * 仅 YYYY-MM-DD 日期形态；空值不写键（不覆盖存量遗留 false）；裸日期无引号落盘由
 * 服务端 stringifyPostMarkdown 权威保证（js-yaml 两路默认输出均非官方形态，实证见实现处）。
 */
const fm = ref({
  title: '',
  description: '',
  tags: [] as string[],
  category: '',
  author: '',
  permalink: '',
  pinned: false,
  draft: false,
  /** [Phase4-D4/S3/B1b] 官方发布日期（可选；空 = 不写键，存量键不被覆盖） */
  published: '',
  image: '',
  /** [B3.6] 默认当天（与 B1 SchemaForm 一致）；编辑时 populateForm 覆盖 */
  date: todayString(),
  pubDate: todayString(),
  /** [Phase3-C5] 语言（可选）：空 = 站点默认（Server 端空串归一为未设置） */
  lang: '',
  /** [Phase3-C1/决议 2] 加密与发布区块：加密开关 / 密码 / 评论禁用（继承全局 = 取消勾选） */
  encrypted: false,
  password: '',
  commentDisabled: false,
});

/** 标签输入 */
const tagInput = ref('');

/** 后端字段错误 */
const serverErrors = ref<Record<string, string>>({});

/** 封面上传 */
const coverUploading = ref(false);

onMounted(async () => {
  if (isEdit.value) {
    await loadPost();
  }
});

async function loadPost(): Promise<void> {
  loading.value = true;
  try {
    const post = await postsApi.read(editingSlug.value);
    content.value = post.content;
    fullFm.value = { ...post.frontmatter };
    postSource.value = post.source; // [S4] 形态标志驱动面板只读分派
    populateForm(post.frontmatter);
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '加载失败');
    router.push('/posts');
  } finally {
    loading.value = false;
  }
}

/** 从完整 frontmatter 填充表单字段（15 已知字段；[Phase4-D4/B1] published 不再入表单） */
function populateForm(fmData: Record<string, unknown>): void {
  fm.value.title = typeof fmData['title'] === 'string' ? fmData['title'] : '';
  fm.value.description = typeof fmData['description'] === 'string' ? fmData['description'] : '';
  fm.value.tags = Array.isArray(fmData['tags']) ? (fmData['tags'] as string[]) : [];
  fm.value.category = typeof fmData['category'] === 'string' ? fmData['category'] : '';
  fm.value.author = typeof fmData['author'] === 'string' ? fmData['author'] : '';
  fm.value.permalink = typeof fmData['permalink'] === 'string' ? fmData['permalink'] : '';
  fm.value.pinned = fmData['pinned'] === true;
  // [Phase4-D4/B1] 草稿判定与服务端 deriveStatus 兼容口径一致：
  //   draft===true，或存量遗留 published===false（历史面板误写布尔开关）→ 视为草稿展示
  fm.value.draft = fmData['draft'] === true || fmData['published'] === false;
  // [Phase4-D4/S3/B1b] published 日期回填：Date/日期字符串 → yyyy-mm-dd；
  // 遗留布尔 false → 空（不误填选择器，遗留态由 publishedLegacy 警示承载）
  fm.value.published = dateToString(fmData['published']);
  fm.value.image = typeof fmData['image'] === 'string' ? fmData['image'] : '';
  fm.value.date = dateToString(fmData['date']);
  fm.value.pubDate = dateToString(fmData['pubDate']);
  // [Phase3-C5] 语言：缺省/非字符串 = 空（站点默认）；存量文章不回填（缺省语义天然成立）
  fm.value.lang = typeof fmData['lang'] === 'string' ? fmData['lang'] : '';
  // [Phase3-C1] 加密与发布：comment 仅显式 false 视为禁用（缺失 = 继承全局）
  fm.value.encrypted = fmData['encrypted'] === true;
  fm.value.password = typeof fmData['password'] === 'string' ? fmData['password'] : '';
  fm.value.commentDisabled = fmData['comment'] === false;
}

function dateToString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return '';
}

/**
 * 构建提交用的 frontmatter（合并：未知键保留 + 已知字段覆盖）。
 * [Phase3-C1] 四可删键按 null 提交（依托 Server PATCH 删键语义）：
 * encrypted 关闭 / password 空串 / comment 取消勾选 / permalink 清空 → null（删键）。
 * [Phase4-D4/B1→S3] 不再提交 published 布尔值（布尔开关语义废除，ADR-025）；S3 起以
 * 官方日期形态提交：空值不写键（undefined → JSON 丢键 → PATCH 合并保留存量值，遗留
 * false 不被覆盖），日期形态经服务端 stringifyPostMarkdown 以裸日期落盘。
 * [Phase4-D4/S5] description 可选（supersede B2.1/裁决 8）：原样提交（含空串，
 * 空串为合法存储值），不再 || undefined 归一。
 */
function buildFrontmatter(): Record<string, unknown> {
  return {
    ...fullFm.value,
    title: fm.value.title,
    description: fm.value.description,
    tags: fm.value.tags.length > 0 ? fm.value.tags : undefined,
    category: fm.value.category || undefined,
    author: fm.value.author || undefined,
    pinned: fm.value.pinned,
    draft: fm.value.draft,
    // [Phase4-D4/S3/B1b] published 日期（可选；空 = 不写键，见上方函数注）
    published: fm.value.published || undefined,
    image: fm.value.image || undefined,
    date: fm.value.date || undefined,
    pubDate: fm.value.pubDate || undefined,
    // [Phase3-C5 / Phase4-D4c/C1] 语言：空 = 站点默认 → 显式提交 null（lang ∈
    // NULL_DELETE_KEYS 删键哨兵）。此前 || undefined 使清空经 JSON 丢键、PATCH
    // 增量合并保留存量 lang 键（D4b 遗留，用户真机复现：清空保存后键不消失）。
    lang: fm.value.lang.trim() || null,
    encrypted: fm.value.encrypted || null,
    password: fm.value.password || null,
    comment: fm.value.commentDisabled ? false : null,
    permalink: fm.value.permalink || null,
  };
}

/** 标签操作 */
function addTag(): void {
  const value = tagInput.value.trim();
  if (value !== '' && !fm.value.tags.includes(value)) {
    fm.value.tags.push(value);
  }
  tagInput.value = '';
}

/** [B3.6] 日期选择回调：el-date-picker 清空回调 null → 空串（保持 string 语义） */
function onDatePick(field: 'date' | 'pubDate' | 'published', value: unknown): void {
  fm.value[field] = dateOrEmpty(value);
}

function removeTag(index: number): void {
  fm.value.tags.splice(index, 1);
}

/** 保存 */
async function onSave(): Promise<void> {
  // [Phase4-D4/C2] 原 B2b 文件形态只读守卫已拆除（编辑解除，supersede 分派）
  if (fm.value.title.trim() === '') {
    ElMessage.warning('标题为必填');
    return;
  }
  // [Phase4-D4/S5] 原 description 必填拦截已拆除（描述可选，supersede B2.1/裁决 8；
  // 空串为合法存储值，p5b ② 锚钉版）
  saving.value = true;
  serverErrors.value = {};
  try {
    if (isEdit.value) {
      await postsApi.update(editingSlug.value, {
        frontmatter: buildFrontmatter(),
        content: content.value,
      });
      ElMessage.success('保存成功');
    } else {
      const result = await postsApi.create({
        slug: newSlug.value,
        frontmatter: buildFrontmatter(),
        content: content.value,
      });
      ElMessage.success('创建成功');
      router.replace(`/posts/${encodeURIComponent(result.slug)}/edit`);
    }
    // 重新读取以同步 fullFm（往返保真）
    if (isEdit.value || newSlug.value !== '') {
      const slug = isEdit.value ? editingSlug.value : newSlug.value;
      const post = await postsApi.read(slug);
      fullFm.value = { ...post.frontmatter };
      postSource.value = post.source; // [S4] 保存后重读同步形态标志
      content.value = post.content;
      populateForm(post.frontmatter);
    }
  } catch (err) {
    handleError(err);
  } finally {
    saving.value = false;
  }
}

/** 新建时的 slug 输入 */
const newSlug = ref('');

/** 封面上传 */
async function onCoverUpload(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file === undefined) {
    return;
  }
  // [Phase4-D4/S4/B2b→C2] 封面上传守卫保留（服务端规则④ 400 同构；编辑解除不影响封面限制）
  if (isFileForm.value) {
    ElMessage.warning(FILE_FORM_HINT);
    return;
  }
  if (!isEdit.value) {
    ElMessage.warning('请先保存文章再上传封面');
    return;
  }
  coverUploading.value = true;
  try {
    await postsApi.uploadCover(editingSlug.value, file);
    ElMessage.success('封面上传成功（已转 JPG）');
    await loadPost();
  } catch (err) {
    handleError(err);
  } finally {
    coverUploading.value = false;
    input.value = ''; // 重置以便重复选同一文件
  }
}

/** 上传 Markdown 文件 → 填入编辑器 */
function onMdUpload(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file === undefined) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result;
    if (typeof text === 'string') {
      content.value = text;
      ElMessage.success('已填入编辑器');
    }
  };
  reader.readAsText(file);
  input.value = '';
}

/**
 * 统一错误处理：提示（notify 单源）+ 字段级错误回填。
 * [Wave-4/F5] 原实现手写了一遍 issues 遍历（同一归一化逻辑的第 3 套实现）；
 * 现复用 api/articles 的 extractArticleIssues（path→message 单源）。
 */
function handleError(err: unknown): void {
  notifyApiError(err, '操作失败');
  if (err instanceof ApiError) {
    Object.assign(serverErrors.value, extractArticleIssues(err.detail));
  }
}

function goBack(): void {
  router.push('/posts');
}/** 未知 frontmatter 键（非 16 个已知字段） */
const KNOWN_FM_KEYS = new Set([
  'title', 'published', 'description', 'tags', 'category', 'author',
  'permalink', 'pinned', 'draft', 'image', 'date', 'pubDate',
  'encrypted', 'password', 'comment', 'lang',
]);
const unknownKeys = computed<string[]>(() =>
  Object.keys(fullFm.value).filter((k) => !KNOWN_FM_KEYS.has(k)),
);

/**
 * [Phase4-D4/B1→S3] 存量 published 遗留布尔 false 展示：日期形态已升格为可编辑字段
 * （S3 日期选择器回补，见「published」表单项），仅布尔 false（历史面板误写开关，
 * ADR-025）仍需显式警示——服务端按 draft 处理以免草稿公开；用户在「published」日期
 * 字段设值保存即可迁移（该键被日期覆盖）。
 */
const publishedLegacy = computed<string | null>(() => {
  if (fullFm.value['published'] === false) {
    return '检测到遗留 published: false（历史面板误写的布尔开关）：服务端按草稿处理以免公开；可在「published」日期字段设值保存以完成迁移（该键将被日期覆盖）';
  }
  return null;
});

/** 格式化未知键的值用于展示 */
function formatValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}
</script>

<template>
  <div class="post-edit-page" v-loading="loading">
    <div class="page-header">
      <el-button @click="goBack">返回</el-button>
      <h2>{{ isEdit ? '编辑文章' : '新建文章' }}</h2>
      <div class="header-actions">
        <el-select v-model="engine" size="small" @change="onEngineChange" style="width: 100px">
          <el-option label="Vditor" value="vditor" />
          <el-option label="CodeMirror" value="codemirror" />
        </el-select>
        <!-- [Phase4-D2/需求4] 图片按钮：媒体库/相册/外链统一选图入口 -->
        <el-button size="small" @click="imagePickerVisible = true">图片</el-button>
        <label class="upload-btn">
          <span>上传 Markdown</span>
          <input type="file" accept=".md,.markdown,.txt" hidden @change="onMdUpload" />
        </label>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </div>
    </div>

    <!-- [Phase4-D4/S4/B2b→C2] 文件形态提示条（编辑已解除，supersede B2b 只读分派；
         剩余限制仅封面/删除，服务端规则③④保留同构） -->
    <el-alert
      v-if="isFileForm"
      type="info"
      :closable="false"
      show-icon
      class="file-form-alert"
      title="文件形态文章（<slug>.md）：可直接编辑保存；封面上传与删除请在文件系统/源文件操作"
    />

    <div class="edit-layout">
      <!-- 正文 -->
      <div class="content-area">
        <div v-if="!isEdit" class="slug-input">
          <el-input v-model="newSlug" placeholder="slug（目录名）" />
        </div>
        <VditorEditor
          v-if="engine === 'vditor'"
          ref="editorRef"
          :model-value="content"
          :content-slug="isEdit ? editingSlug : newSlug"
          @update:model-value="content = $event"
          placeholder="输入 Markdown 正文…"
          height="100%"
        />
        <CodeMirrorEditor
          v-else
          ref="editorRef"
          :model-value="content"
          @update:model-value="content = $event"
          placeholder="输入 Markdown 正文…"
        />
      </div>

      <!-- frontmatter 侧栏（[S4→C2] 文件形态编辑已解除：el-form disabled 撤销；封面入口仍隐藏） -->
      <div class="fm-sidebar">
        <el-form label-width="80px" size="small">
          <el-form-item label="标题" required>
            <el-input v-model="fm.title" />
            <div v-if="serverErrors['title']" class="field-error">{{ serverErrors['title'] }}</div>
          </el-form-item>
          <!-- [Phase4-D4/B1→S3] 已发布布尔开关已移除（官方 published 为发布日期非开关），
               发布状态由下方草稿开关反向表达；日期形态见下方 published 字段（S3 回补） -->
          <el-form-item label="草稿">
            <el-switch v-model="fm.draft" />
          </el-form-item>
          <!-- [Phase4-D4/B1] 存量 published 遗留值提示（面板停写该键，ADR-025） -->
          <div v-if="publishedLegacy" class="fm-legacy-hint">{{ publishedLegacy }}</div>
          <el-form-item label="置顶">
            <el-switch v-model="fm.pinned" />
          </el-form-item>
          <el-form-item label="描述">
            <el-input v-model="fm.description" type="textarea" :rows="3" />
          </el-form-item>
          <el-form-item label="标签">
            <div class="tag-input-group">
              <el-tag
                v-for="(tag, index) in fm.tags"
                :key="index"
                closable
                size="small"
                @close="removeTag(index)"
                style="margin-right: 4px"
              >{{ tag }}</el-tag>
              <el-input
                v-model="tagInput"
                size="small"
                style="width: 100px"
                placeholder="回车添加"
                @keydown.enter.prevent="addTag"
              />
            </div>
          </el-form-item>
          <el-form-item label="分类">
            <el-input v-model="fm.category" />
          </el-form-item>
          <el-form-item label="作者">
            <el-input v-model="fm.author" />
          </el-form-item>
          <!-- [Phase3-C5] 语言（可选）：空 = 站点默认；BCP-47 简码由服务端校验 -->
          <el-form-item label="语言">
            <el-input v-model="fm.lang" placeholder="en" />
          </el-form-item>
          <el-form-item label="封面">
            <el-input v-model="fm.image" placeholder="cover.jpg 或路径" />
            <label v-if="isEdit && !isFileForm" class="upload-btn" :class="{ disabled: coverUploading }">
              <span>{{ coverUploading ? '上传中...' : '上传封面图' }}</span>
              <input type="file" accept=".jpg,.jpeg,.png,.webp,.gif" hidden @change="onCoverUpload" :disabled="coverUploading" />
            </label>
          </el-form-item>
          <el-form-item label="日期">
            <!-- [B3.6] el-date-picker（YYYY-MM-DD）替代裸 el-input -->
            <el-date-picker
              :model-value="fm.date || undefined"
              type="date"
              value-format="YYYY-MM-DD"
              format="YYYY-MM-DD"
              placeholder="选择日期"
              class="date-input"
              @update:model-value="(v: unknown) => onDatePick('date', v)"
            />
          </el-form-item>
          <!-- [Phase4-D4d/D1] label 正名（C4 防重名方案的自我修正）：pubDate 保留
               英文键名锚定（与 date「日期」、published「发布日期」三者互异防混淆） -->
          <el-form-item label="pubDate">
            <el-date-picker
              :model-value="fm.pubDate || undefined"
              type="date"
              value-format="YYYY-MM-DD"
              format="YYYY-MM-DD"
              placeholder="选择日期"
              class="date-input"
              @update:model-value="(v: unknown) => onDatePick('pubDate', v)"
            />
          </el-form-item>
          <!-- [Phase4-D4/S3/B1b→C4/D4d] published 官方日期字段（可选；空 = 不写键；裸日期
               落盘由服务端 stringifyPostMarkdown 权威保证）。遗留布尔 false 由上方
               fm-legacy-hint 警示，此处设值保存即完成迁移。
               [Phase4-D4d/D1] label 正名终态「发布日期」（pubDate 改键名锚定 pubDate，
               三字段 date/pubDate/published 标签互异，重名消除） -->
          <el-form-item label="发布日期">
            <el-date-picker
              :model-value="fm.published || undefined"
              type="date"
              value-format="YYYY-MM-DD"
              format="YYYY-MM-DD"
              placeholder="选择日期"
              class="date-input"
              @update:model-value="(v: unknown) => onDatePick('published', v)"
            />
          </el-form-item>

          <!-- [Phase3-C1/决议 2] 加密与发布区块：字段由主题构建期消费，Server 仅存储 -->
          <el-divider content-position="left">加密与发布</el-divider>
          <div class="encrypt-hint">加密由主题在构建期完成（客户端解密），此处仅保存配置字段</div>
          <el-form-item label="加密">
            <el-switch v-model="fm.encrypted" />
          </el-form-item>
          <el-form-item label="密码">
            <el-input v-model="fm.password" type="password" show-password placeholder="your-secret-password" />
          </el-form-item>
          <el-form-item label="禁用评论">
            <el-checkbox v-model="fm.commentDisabled">禁用本文评论</el-checkbox>
          </el-form-item>
          <el-form-item label="固定链接">
            <el-input v-model="fm.permalink" placeholder="encrypted-example" />
          </el-form-item>
        </el-form>

        <!-- 未知 frontmatter 键提示 -->
        <div v-if="unknownKeys.length > 0" class="unknown-keys">
          <el-divider content-position="left">额外字段（原样保留）</el-divider>
          <div v-for="key in unknownKeys" :key="key" class="unknown-key">
            <span class="key">{{ key }}:</span>
            <span class="value">{{ formatValue(fullFm[key]) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- [Phase4-D2/需求4] 统一选图器（媒体库/相册/外链） -->
    <MediaPicker v-model="imagePickerVisible" @picked="onImagesPicked" />
  </div>
</template>

<style scoped>
.post-edit-page {
  padding: 16px;
  /* [Phase4-D1/缺陷三] 视口高度对齐：页高 = 视口高 − MainLayout 顶栏 60px
     − el-main 上下 padding 40px；编辑区在此页内滚动（滚动归属：vditor 内容区），
     工具栏/表单不再随页滚出视口。 */
  height: calc(100vh - 100px);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-shrink: 0;
}

.page-header h2 {
  margin: 0;
  flex: 1;
}

/* [Phase4-D4/S4/B2b] 文件形态只读警示条（flex 列内固定高，不随内容区滚动） */
.file-form-alert {
  margin-bottom: 12px;
  flex-shrink: 0;
}

.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.edit-layout {
  display: flex;
  gap: 16px;
  /* [Phase4-D1/缺陷三] 占满页高剩余部分并为子项提供可收缩高度上下文 */
  flex: 1;
  min-height: 0;
}

.content-area {
  flex: 1;
  min-width: 0;
  /* [Phase4-D1/缺陷三] 弹性列：slug 输入（新建态）占固有高，编辑器填满剩余 */
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* [Phase4-D1/缺陷三] 编辑器根在弹性列中吃满剩余高度（覆盖包装层 height:100%） */
.content-area > :deep(.vditor-editor) {
  flex: 1 1 0;
  min-height: 0;
  height: auto;
}

.slug-input {
  margin-bottom: 8px;
  flex-shrink: 0;
}

.fm-sidebar {
  width: 320px;
  flex-shrink: 0;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  padding: 12px;
  /* [Phase4-D1/缺陷三] 高度随行（行高已视口对齐），侧栏内部自滚 */
  max-height: 100%;
  overflow-y: auto;
}

/* [Phase4-D4d/D2] 侧栏 label 防折行：label-width 80px 内长 label（如修复前
   「发布日期（published）」）折两行并与下方分区 divider 重叠（修复前截图实证）；
   D1 正名后最长 label = 4 字已回安全宽，nowrap 为防御加固（超宽溢出可见、不折行） */
.fm-sidebar :deep(.el-form-item__label) {
  white-space: nowrap;
}

/* [Phase4-D4d/D2] 分区标题与上方表单项间距：divider 默认 margin 过窄，
   修复前与折行 label 视觉重叠；统一上间距 16px 下 12px 拉开分区呼吸感 */
.fm-sidebar :deep(.el-divider--horizontal) {
  margin: 16px 0 12px;
}

.tag-input-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.date-input {
  width: 100%;
}

.encrypt-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin: 0 0 8px;
}

.upload-btn {
  display: inline-block;
  cursor: pointer;
  color: var(--el-color-primary);
  font-size: 13px;
}

.upload-btn.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.field-error {
  color: var(--el-color-danger);
  font-size: 12px;
}

/* [Phase4-D4/B1] 存量 published 遗留值提示（警告色浅底条） */
.fm-legacy-hint {
  margin: 0 0 12px;
  padding: 6px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-color-warning-dark-2);
  background: var(--el-color-warning-light-9);
  border-radius: 4px;
}

.unknown-keys {
  margin-top: 12px;
}

.unknown-key {
  font-size: 13px;
  margin-bottom: 4px;
}

.unknown-key .key {
  color: var(--el-text-color-secondary);
  margin-right: 6px;
}

.unknown-key .value {
  color: var(--el-text-color-secondary);
  word-break: break-all;
}
</style>
