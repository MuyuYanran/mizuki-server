<script setup lang="ts">
/**
 * [P10c] Markdown 文章列表（含草稿箱、回收站）
 * [职责] 三视图 tab：全部（GET /admin/posts）、草稿箱（status==='draft' 筛选）、
 *   回收站（localStorage 跟踪的已删文章，恢复经备份 restore + sync）。
 *   操作：新建、编辑、删除（二次确认）、置顶切换。
 * [状态] ACTIVE
 *
 * 回收站取舍（§3.1）：后端无「list deleted」端点，前端 localStorage 跟踪
 * 删除时的 backupIds；恢复 = 逐备份 restore → POST /admin/posts/sync。
 * [U3-P4c/K8] 增「导入」三步弹窗（选文件 → 预览与映射 → 逐条提交）：浏览器只搬运原文
 * （YAML 解析/键映射在服务端，预览端点只读）；提交逐条复用既有 POST /admin/posts。
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  IMPORT_ALLOWED_EXTENSIONS,
  IMPORT_MAX_FILE_BYTES,
  IMPORT_MAX_FILES,
} from '@mizuki/shared';
import {
  postsApi,
  recycleStore,
  restorePost,
  type ImportPreviewItem,
  type PostListItem,
  type RecycleEntry,
} from '../../api/posts';
import { ApiError } from '../../api/http';

type TabKind = 'all' | 'drafts' | 'recycle';

const router = useRouter();

const activeTab = ref<TabKind>('all');
const loading = ref(false);
const posts = ref<PostListItem[]>([]);
const recycle = ref<RecycleEntry[]>([]);

/** 全部文章 */
const allPosts = computed(() => posts.value);

/** 草稿箱（status === 'draft'） */
const draftPosts = computed(() => posts.value.filter((p) => p.status === 'draft'));

/** 当前 tab 的数据 */
const currentList = computed<PostListItem[]>(() => {
  if (activeTab.value === 'drafts') {
    return draftPosts.value;
  }
  return allPosts.value;
});

onMounted(load);

async function load(): Promise<void> {
  loading.value = true;
  try {
    if (activeTab.value !== 'recycle') {
      posts.value = await postsApi.list();
    }
    recycle.value = recycleStore.list();
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

/** 切换 tab 时按需加载 */
function onTabChange(tab: string | number): void {
  const kind = tab as TabKind;
  activeTab.value = kind;
  if (kind !== 'recycle' && posts.value.length === 0) {
    load();
  }
}

function goNew(): void {
  router.push('/posts/new');
}

function goEdit(slug: string): void {
  router.push(`/posts/${encodeURIComponent(slug)}/edit`);
}

/** [Phase4-D4f/F3] 删除限制解除：原 B2b/C2 删除守卫（FILE_FORM_HINT + 禁用）撤除，
 * 「文件」徽标保留（title 转为形态说明）；file-form 与目录式删除同走「备份 → 回收站恢复」 */

/** 置顶切换 */
async function togglePinned(row: PostListItem): Promise<void> {
  // [Phase4-D4/C2] 原 B2b 置顶守卫已拆除（file-form 编辑解除，updatePost 可达）
  const current = row.frontmatter['pinned'] === true;
  const next = !current;
  try {
    await postsApi.update(row.slug, { frontmatter: { pinned: next } });
    row.frontmatter['pinned'] = next;
    ElMessage.success(next ? '已置顶' : '已取消置顶');
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '操作失败');
  }
}

/** 删除（二次确认 → 记入回收站）；[D4f/F3] file-form 守卫撤除（服务端删除已解除） */
async function onDelete(row: PostListItem): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除文章「${row.slug}」？（可从回收站恢复）`, '删除确认', {
      type: 'warning',
    });
  } catch {
    return; // 取消
  }
  try {
    const result = await postsApi.remove(row.slug);
    recycleStore.add({
      slug: row.slug,
      title: typeof row.frontmatter['title'] === 'string' ? row.frontmatter['title'] : row.slug,
      backupIds: result.backupIds,
      deletedAt: new Date().toISOString(),
    });
    posts.value = posts.value.filter((p) => p.slug !== row.slug);
    recycle.value = recycleStore.list();
    ElMessage.success('已删除（可从回收站恢复）');
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '删除失败');
  }
}

/** 从回收站恢复 */
async function onRestore(entry: RecycleEntry): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认恢复文章「${entry.slug}」？`, '恢复确认');
  } catch {
    return;
  }
  try {
    await restorePost(entry);
    recycle.value = recycleStore.list();
    await load();
    ElMessage.success('已恢复');
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '恢复失败');
  }
}

/** 从回收站彻底清除（仅清 localStorage 记录，不影响后端） */
function onPurge(entry: RecycleEntry): void {
  recycleStore.remove(entry.slug);
  recycle.value = recycleStore.list();
  ElMessage.success('已从回收站列表清除');
}

/** 取标题 */
function titleOf(row: PostListItem): string {
  return typeof row.frontmatter['title'] === 'string' ? row.frontmatter['title'] : row.slug;
}

/** 取置顶 */
function pinnedOf(row: PostListItem): boolean {
  return row.frontmatter['pinned'] === true;
}

/** [Phase4-D4/C4] 状态标签 i18n（published/draft 英文裸值 → 中文；未知值回退原文） */
const STATUS_LABELS: Record<string, string> = { published: '已发布', draft: '草稿' };
function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** 取日期 */
function dateOf(row: PostListItem): string {
  const d = row.frontmatter['pubDate'] ?? row.frontmatter['date'];
  if (typeof d === 'string') {
    return d;
  }
  if (d instanceof Date) {
    return d.toISOString().slice(0, 10);
  }
  return '';
}

// ── [U3-P4c/K8] Markdown 通用导入（三步弹窗：选文件 → 预览与映射 → 逐条提交） ──
//
// 纪律（K8/再裁 A）：浏览器只做 File→FormData 搬运与上限预检；YAML 解析、键映射、
// 校验全部在服务端（预览端点只读）。**不在任何前端状态里持久化导入内容**——
// 状态只在内存，关闭弹窗即丢弃。

/** 当前步骤：1 选文件 / 2 预览 / 3 提交结果 */
type ImportStep = 1 | 2 | 3;

/** 逐条提交结果（提交阶段复用既有 POST /admin/posts，逐条收 201/400/409） */
interface ImportCommitResult {
  name: string;
  slug: string;
  /** HTTP 状态码；0 = 网络/未知错误 */
  status: number;
  ok: boolean;
  message: string;
}

const importVisible = ref(false);
const importStep = ref<ImportStep>(1);
const importPreviewLoading = ref(false);
const importCommitting = ref(false);
const importFileInput = ref<HTMLInputElement | null>(null);
/** 本次选中的文件（仅内存，用于重发预览；关闭弹窗即丢弃） */
const importFiles = ref<File[]>([]);
/** 预览结果（类型直接取 shared 契约，零本地复制） */
const importItems = ref<ImportPreviewItem[]>([]);
/** 可编辑 slug（与 importItems 同下标；写盘时作为目录名） */
const importSlugs = ref<string[]>([]);
/** 逐行勾选（与 importItems 同下标；仅 status === 'ok' 的行可勾） */
const importSelected = ref<boolean[]>([]);
const importResults = ref<ImportCommitResult[]>([]);
const importProgress = ref({ done: 0, total: 0 });

/** `accept` 属性与上限文案均由 shared 常量派生（K2 单源） */
const IMPORT_ACCEPT = IMPORT_ALLOWED_EXTENSIONS.join(',');
const IMPORT_MAX_KIB = Math.floor(IMPORT_MAX_FILE_BYTES / 1024);

const importRows = computed(() =>
  importItems.value.map((item, index) => ({
    index,
    item,
    name: item.name,
    slug: importSlugs.value[index] ?? item.slug,
    status: item.status,
    code: item.code ?? '',
    mapped: item.mapped,
    issues: item.issues,
    frontmatter: item.frontmatter,
    content: item.content,
    selectable: item.status === 'ok',
    selected: importSelected.value[index] === true,
  })),
);

const importSelectableCount = computed(
  () => importRows.value.filter((row) => row.selectable).length,
);
const importSelectedCount = computed(
  () => importRows.value.filter((row) => row.selectable && row.selected).length,
);
/** 全选态：可提交行全部被勾选（无行时不算全选） */
const importAllSelected = computed(
  () => importSelectableCount.value > 0 && importSelectedCount.value === importSelectableCount.value,
);
const importPercent = computed(() =>
  importProgress.value.total === 0
    ? 0
    : Math.round((importProgress.value.done / importProgress.value.total) * 100),
);
/** 提交汇总（K4：部分失败不回滚，逐条报结果） */
const importSummary = computed(() => ({
  ok: importResults.value.filter((result) => result.ok).length,
  failed: importResults.value.filter((result) => !result.ok).length,
  skipped: importItems.value.length - importResults.value.length,
}));

function resetImportState(): void {
  importFiles.value = [];
  importItems.value = [];
  importSlugs.value = [];
  importSelected.value = [];
  importResults.value = [];
  importProgress.value = { done: 0, total: 0 };
  importStep.value = 1;
}

function openImport(): void {
  resetImportState();
  importVisible.value = true;
}

function pickImportFiles(): void {
  importFileInput.value?.click();
}

/** 扩展名小写形（含点；无点 → ''） */
function importExtOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

/**
 * [K2] 前端自检三道上限（不合格**不发请求**，直接给中文错误）：
 * ① 文件数 ≤ IMPORT_MAX_FILES；② 单文件 ≤ IMPORT_MAX_FILE_BYTES；③ 仅 .md/.markdown。
 * 返回 null = 通过。
 */
function validateImportFiles(files: File[]): string | null {
  if (files.length === 0) {
    return '请选择至少一个 Markdown 文件';
  }
  if (files.length > IMPORT_MAX_FILES) {
    return `一次最多导入 ${IMPORT_MAX_FILES} 个文件（本次选中 ${files.length} 个），请分批导入`;
  }
  const badExt = files.filter(
    (file) => !(IMPORT_ALLOWED_EXTENSIONS as readonly string[]).includes(importExtOf(file.name)),
  );
  if (badExt.length > 0) {
    return `仅支持 ${IMPORT_ALLOWED_EXTENSIONS.join(' / ')} 文件：${badExt
      .map((file) => file.name)
      .join('、')}`;
  }
  const tooBig = files.filter((file) => file.size > IMPORT_MAX_FILE_BYTES);
  if (tooBig.length > 0) {
    return `单文件不得超过 ${IMPORT_MAX_KIB} KiB：${tooBig
      .map((file) => `${file.name}（${(file.size / 1024).toFixed(1)} KiB）`)
      .join('、')}`;
  }
  return null;
}

async function onImportFilesPicked(event: Event): Promise<void> {
  const input = event.target instanceof HTMLInputElement ? event.target : null;
  const fileList = input?.files ?? null;
  const files = fileList === null ? [] : Array.from(fileList);
  if (input !== null) {
    // 清空以便重复选择同一文件仍触发 change
    input.value = '';
  }
  const invalid = validateImportFiles(files);
  if (invalid !== null) {
    ElMessage.error(invalid);
    return;
  }
  importFiles.value = files;
  await runImportPreview();
}

/** [K1] 预览：multipart 一次性上传整批（服务端零落盘），成功后进入第 2 步 */
async function runImportPreview(): Promise<void> {
  importPreviewLoading.value = true;
  try {
    const res = await postsApi.previewImport(importFiles.value);
    importItems.value = res.items;
    importSlugs.value = res.items.map((item) => item.slug);
    importSelected.value = res.items.map((item) => item.status === 'ok');
    importResults.value = [];
    importProgress.value = { done: 0, total: 0 };
    importStep.value = 2;
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '导入预览失败');
  } finally {
    importPreviewLoading.value = false;
  }
}

function setImportSlug(index: number, slug: string): void {
  const next = [...importSlugs.value];
  next[index] = slug;
  importSlugs.value = next;
}

function setImportSelected(index: number, selected: boolean): void {
  const next = [...importSelected.value];
  next[index] = selected;
  importSelected.value = next;
}

/** 全选/全不选：只作用于可提交（status === 'ok'）的行 */
function toggleSelectAllImports(selected: boolean): void {
  importSelected.value = importItems.value.map((item) => item.status === 'ok' && selected);
}

/**
 * [K6/K9] 逐条提交：仅勾选且 `status==='ok'` 的条目，**顺序**调用既有
 * `POST /admin/posts`（不并发：全局限流 60/min + SQLite 写锁）；`form` 固定目录式。
 * 服务端不信任预览——每条都重跑 zod，409/400 逐条落进结果表；不做整体回滚。
 */
async function commitImport(): Promise<void> {
  const chosen = importRows.value.filter((row) => row.selectable && row.selected);
  if (chosen.length === 0) {
    ElMessage.warning('没有可提交的条目（仅「ok」条目可提交）');
    return;
  }
  importCommitting.value = true;
  importStep.value = 3;
  importResults.value = [];
  importProgress.value = { done: 0, total: chosen.length };
  const results: ImportCommitResult[] = [];
  for (const row of chosen) {
    const slug = row.slug.trim();
    try {
      const created = await postsApi.create({
        slug,
        frontmatter: row.item.frontmatter,
        content: row.item.content,
        form: 'dir',
      });
      results.push({ name: row.name, slug: created.slug, status: 201, ok: true, message: '已导入' });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      results.push({
        name: row.name,
        slug,
        status,
        ok: false,
        message: err instanceof ApiError ? err.message : '提交失败',
      });
    }
    importResults.value = [...results];
    importProgress.value = { done: results.length, total: chosen.length };
  }
  importCommitting.value = false;
  // 刷新列表：回收站 tab 下 load() 不拉文章列表，故显式补一次（导入结果要立刻可见）
  if (activeTab.value === 'recycle') {
    posts.value = await postsApi.list();
    recycle.value = recycleStore.list();
  } else {
    await load();
  }
  if (importSummary.value.failed === 0) {
    ElMessage.success(`导入完成：成功 ${importSummary.value.ok} 篇`);
  } else {
    ElMessage.warning(
      `导入结束：成功 ${importSummary.value.ok} 篇 / 失败 ${importSummary.value.failed} 篇`,
    );
  }
}
</script>

<template>
  <div class="post-list-page panel-card">
    <div class="page-header">
      <div class="header-title-wrap">
        <h2>Markdown 文章</h2>
        <span class="header-desc">管理博客文章、草稿与回收站</span>
      </div>
      <div class="header-actions">
        <el-button @click="openImport">导入</el-button>
        <el-button type="primary" class="btn-gradient-primary" @click="goNew">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          新建文章
        </el-button>
      </div>
    </div>

    <el-tabs :model-value="activeTab" @tab-change="onTabChange">
      <el-tab-pane label="全部" name="all" />
      <el-tab-pane label="草稿箱" name="drafts" />
      <el-tab-pane label="回收站" name="recycle" />
    </el-tabs>

    <!-- 全部 / 草稿箱 -->
    <el-table v-if="activeTab !== 'recycle'" v-loading="loading" :data="currentList" border>
      <el-table-column prop="slug" label="slug" width="180" />
      <el-table-column label="标题">
        <template #default="{ row }">{{ titleOf(row) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">{{ statusLabel(row.status) }}</template>
      </el-table-column>
      <el-table-column label="置顶" width="80">
        <template #default="{ row }">
          <el-tag v-if="pinnedOf(row)" type="warning" size="small">置顶</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="日期" width="120">
        <template #default="{ row }">{{ dateOf(row) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="300" fixed="right">
        <template #default="{ row }">
          <!-- [Phase4-D4f/F3] 「文件」徽标保留（title = 形态说明）；删除禁用守卫撤除
               （file-form 单文件删除已解除，backupIds 回收站语义同目录式） -->
          <el-tag v-if="row.source === 'file'" type="info" size="small" :title="`${row.slug}.md 单文件文章`">文件</el-tag>
          <el-button size="small" @click="goEdit(row.slug)">编辑</el-button>
          <el-button size="small" @click="togglePinned(row)">
            {{ pinnedOf(row) ? '取消置顶' : '置顶' }}
          </el-button>
          <el-button size="small" type="danger" @click="onDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 回收站 -->
    <div v-else>
      <el-alert type="info" :closable="false" show-icon style="margin-bottom: 12px">
        回收站仅记录本浏览器中删除的文章。恢复需后端备份链路可用（POST /admin/backups/:id/restore + sync）。
      </el-alert>
      <el-table :data="recycle" border v-if="recycle.length > 0">
        <el-table-column prop="slug" label="slug" width="180" />
        <el-table-column prop="title" label="标题" />
        <el-table-column prop="deletedAt" label="删除时间" width="180" />
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click="onRestore(row)">恢复</el-button>
            <el-button size="small" @click="onPurge(row)">清除记录</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else description="回收站为空" />
    </div>

    <!-- [U3-P4c/K8] Markdown 通用导入：三步弹窗（选文件 → 预览与映射 → 逐条提交） -->
    <el-dialog
      v-model="importVisible"
      title="导入 Markdown 文章"
      width="960px"
      :close-on-click-modal="!importCommitting"
      :close-on-press-escape="!importCommitting"
      :show-close="!importCommitting"
      @closed="resetImportState"
    >
      <el-steps :active="importStep - 1" finish-status="success" simple class="import-steps">
        <el-step title="选择文件" />
        <el-step title="预览与映射" />
        <el-step title="逐条提交" />
      </el-steps>

      <!-- ① 选文件：本地先检三道上限（不合格不发请求） -->
      <div v-if="importStep === 1" class="import-pick">
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="仅 Markdown 通用导入（Hexo/Hugo/Jekyll 方言与 CMS 迁移不在本批）"
          :description="`最多 ${IMPORT_MAX_FILES} 个文件；单文件 ≤ ${IMPORT_MAX_KIB} KiB；仅 ${IMPORT_ACCEPT}。浏览器只上传原文，frontmatter 解析与键映射在服务端完成（预览不写盘）。`"
        />
        <div class="import-bar">
          <el-button type="primary" class="btn-gradient-primary" @click="pickImportFiles">
            选择 Markdown 文件
          </el-button>
          <span class="import-hint">可多选；选中后立即预览</span>
        </div>
        <input
          ref="importFileInput"
          type="file"
          multiple
          :accept="IMPORT_ACCEPT"
          class="import-file-input"
          aria-label="选择 Markdown 文件"
          @change="onImportFilesPicked"
        />
      </div>

      <!-- ② 预览：逐条 status/code/映射后 frontmatter；conflict/error 不可提交 -->
      <div v-else-if="importStep === 2" v-loading="importPreviewLoading" class="import-preview">
        <el-alert
          type="warning"
          :closable="false"
          show-icon
          title="提交前请核对映射后的 frontmatter（改名/删键是写盘前最后一次可撤销的时点）"
          description="预览只解析不落盘。conflict（slug 已被占用）与 error（frontmatter 非法 / 空文件 / 扩展名不符）条目不可提交；仅 ok 条目逐条调用既有创建接口，部分失败不回滚。"
        />
        <div class="import-bar">
          <el-checkbox
            :model-value="importAllSelected"
            @change="toggleSelectAllImports($event === true)"
          >全选可提交条目</el-checkbox>
          <span class="import-hint">
            已选 {{ importSelectedCount }} / 可提交 {{ importSelectableCount }} / 共 {{ importRows.length }}
          </span>
          <el-button @click="importStep = 1">重新选择文件</el-button>
          <el-button
            type="primary"
            class="btn-gradient-primary"
            :loading="importCommitting"
            :disabled="importSelectedCount === 0"
            @click="commitImport"
          >提交 {{ importSelectedCount }} 条</el-button>
        </div>
        <el-table :data="importRows" border size="small" class="import-table" row-key="index">
          <el-table-column type="expand">
            <template #default="{ row }">
              <div class="import-expand">
                <div class="import-expand-title">映射后的 frontmatter（只读）</div>
                <pre class="import-pre">{{ JSON.stringify(row.frontmatter, null, 2) }}</pre>
                <div class="import-expand-title">正文前 200 字</div>
                <pre class="import-pre">{{ row.content.slice(0, 200) }}</pre>
              </div>
            </template>
          </el-table-column>
          <el-table-column width="54" align="center">
            <template #default="{ row }">
              <el-checkbox
                :model-value="row.selected"
                :disabled="!row.selectable"
                :aria-label="`选择 ${row.name}`"
                @change="setImportSelected(row.index, $event === true)"
              />
            </template>
          </el-table-column>
          <el-table-column prop="name" label="文件名" width="180" show-overflow-tooltip />
          <el-table-column label="slug（可编辑）" width="220">
            <template #default="{ row }">
              <el-input
                :model-value="row.slug"
                size="small"
                :disabled="!row.selectable"
                aria-label="导入 slug"
                @update:model-value="(value: string) => setImportSlug(row.index, value)"
              />
            </template>
          </el-table-column>
          <el-table-column label="状态" width="130">
            <template #default="{ row }">
              <el-tag
                :type="row.status === 'ok' ? 'success' : row.status === 'conflict' ? 'warning' : 'danger'"
                size="small"
              >{{ row.status }}</el-tag>
              <span v-if="row.code !== ''" class="import-code">{{ row.code }}</span>
            </template>
          </el-table-column>
          <el-table-column label="映射变更" width="230">
            <template #default="{ row }">
              <el-tag
                v-for="key in row.mapped.renamed"
                :key="`renamed-${key}`"
                size="small"
                type="warning"
                class="import-badge"
              >改名 → {{ key }}</el-tag>
              <el-tag
                v-for="key in row.mapped.derived"
                :key="`derived-${key}`"
                size="small"
                type="info"
                class="import-badge"
              >派生 {{ key }}</el-tag>
              <el-tag
                v-for="key in row.mapped.dropped"
                :key="`dropped-${key}`"
                size="small"
                type="danger"
                class="import-badge"
              >删除 {{ key }}</el-tag>
              <span
                v-if="row.mapped.renamed.length + row.mapped.derived.length + row.mapped.dropped.length === 0"
                class="import-code"
              >—</span>
            </template>
          </el-table-column>
          <el-table-column label="问题">
            <template #default="{ row }">
              <div v-for="issue in row.issues" :key="`${issue.level}-${issue.path}-${issue.message}`" class="import-issue">
                <el-tag size="small" :type="issue.level === 'error' ? 'danger' : 'warning'">
                  {{ issue.level }}
                </el-tag>
                <span>{{ issue.path === '' ? issue.message : `${issue.path}：${issue.message}` }}</span>
              </div>
              <span v-if="row.issues.length === 0" class="import-code">—</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- ③ 提交：进度 + 逐条结果 + 汇总（成功/失败/跳过） -->
      <div v-else class="import-commit">
        <el-progress
          :percentage="importPercent"
          :status="importCommitting ? undefined : 'success'"
          class="import-progress"
        />
        <div class="import-summary">
          成功 <strong>{{ importSummary.ok }}</strong> / 失败
          <strong>{{ importSummary.failed }}</strong> / 跳过
          <strong>{{ importSummary.skipped }}</strong>
          <span class="import-hint">（跳过 = 未提交的 conflict / error 或未勾选条目）</span>
        </div>
        <el-table :data="importResults" border size="small" max-height="320">
          <el-table-column prop="name" label="文件名" width="200" show-overflow-tooltip />
          <el-table-column prop="slug" label="slug" width="200" show-overflow-tooltip />
          <el-table-column label="结果" width="90">
            <template #default="{ row }">
              <el-tag :type="row.ok ? 'success' : 'danger'" size="small">
                {{ row.ok ? '成功' : '失败' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="说明">
            <template #default="{ row }">
              {{ row.status === 0 ? row.message : `${row.status} · ${row.message}` }}
            </template>
          </el-table-column>
        </el-table>
      </div>

      <template #footer>
        <el-button v-if="importStep === 2" @click="importVisible = false">取消</el-button>
        <el-button
          v-if="importStep === 3"
          type="primary"
          class="btn-gradient-primary"
          :loading="importCommitting"
          @click="importVisible = false"
        >完成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.header-title-wrap h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.header-desc {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
  display: inline-block;
}

/* [U3-P4c/K8] 导入三步弹窗（间距/字号沿用既有 token，无新增色值） */
.header-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}
.import-steps {
  margin-bottom: 16px;
}
.import-file-input {
  display: none;
}
.import-pick {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.import-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 12px 0;
}
.import-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.import-table {
  margin-top: 4px;
}
.import-code {
  margin-left: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.import-badge {
  margin: 0 4px 4px 0;
}
.import-issue {
  display: flex;
  gap: 6px;
  align-items: baseline;
  font-size: 12px;
  margin-bottom: 2px;
}
.import-expand {
  padding: 4px 12px 8px;
}
.import-expand-title {
  font-size: 12px;
  font-weight: 600;
  margin: 6px 0 4px;
  color: var(--el-text-color-secondary);
}
.import-pre {
  margin: 0;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow: auto;
}
.import-summary {
  margin: 8px 0 12px;
  font-size: 13px;
}
.import-progress {
  margin-top: 4px;
}

:deep(.el-tabs__nav-wrap::after) {
  background-color: var(--mizuki-border-hairline);
}

:deep(.el-tabs__item) {
  font-size: 14px;
  font-weight: 500;
  transition: color var(--mizuki-motion-fast) ease;
}

:deep(.el-tabs__item.is-active) {
  font-weight: 600;
}

:deep(.el-table) {
  margin-top: 12px;
}
</style>
