<script setup lang="ts">
/**
 * [T6b] Shirone 内容集合管理页（series / moments 共用）
 *
 * [为什么一个页面吃两个集合] 两者的**读写形状完全同构**（同一后端服务、同一套路由、
 *   响应都是 `{ slug, frontmatter, content }`），差异只在字段表（`lib/content-fields.ts`）。
 *   拆成两个页面会把「加载/只读态/同步提示/错误分流」这套逻辑复制两遍，
 *   任何一处修 bug 都要改两次 —— 这正是 T6b 要避免的。
 *   ⇒ 用路由参数 `:kind` 分派，字段表驱动表单。将来新增同类集合只加一份字段表。
 *
 * [能力感知] 三处消费 `stores/theme`：
 *   ① 路由进入时若该集合不被当前主题支持 ⇒ 直接展示「不适用」而非报错（用户可能手输 URL）；
 *   ② 只读态（git 源回退读工作副本）⇒ 顶部只读横幅 + 隐藏全部写操作按钮；
 *   ③ 写成功后按响应的 `needsSync` 提示跑一次同步（按钮名按主题形态单显）。
 *
 * [错误分流] 前端**不重写判定**，只按后端状态码呈现：
 *   404 ⇒ 主题不支持（提示换主题）；403 ⇒ 落点被拒（展示服务端指路牌原话）；
 *   400 ⇒ 字段校验失败（逐项标红）。
 *
 * [状态] ACTIVE
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { ShironeCollectionSubdir } from '@mizuki/shared';
import { ApiError } from '../../api/http';
import { contentApi, type ContentItem, type ContentWriteMeta } from '../../api/content';
import ContentSyncButton from '../../components/ContentSyncButton.vue';
import ContentWriteHint from '../../components/ContentWriteHint.vue';
import {
  COLLECTION_DESCRIPTIONS,
  COLLECTION_TITLES,
  type ContentFieldDef,
  type MomentImage,
  fieldsOf,
} from '../../lib/content-fields';
import { contentCollectionIds, themeProfile } from '../../stores/theme';

const route = useRoute();
const router = useRouter();

/** 当前集合（路由参数；非法值回退 series —— 路由层已用白名单约束） */
const kind = computed<ShironeCollectionSubdir>(() =>
  route.params['kind'] === 'moments' ? 'moments' : 'series',
);

const fields = computed<readonly ContentFieldDef[]>(() => fieldsOf(kind.value));
const title = computed(() => COLLECTION_TITLES[kind.value]);
const description = computed(() => COLLECTION_DESCRIPTIONS[kind.value]);

const loading = ref(false);
const items = ref<ContentItem[]>([]);
const readOnly = ref(false);
const inContentRepo = ref(false);
const deniedMessage = ref<string | null>(null);
const unsupported = ref(false);

/** 编辑抽屉 */
const drawerOpen = ref(false);
const editingSlug = ref<string | null>(null);
const formValues = ref<Record<string, unknown>>({});
const formErrors = ref<Record<string, string>>({});
const saving = ref(false);
const lastWriteNeedsSync = ref(false);

/** 该集合在当前主题下是否可用（能力未加载时 fail-open，不拦） */
const supported = computed<boolean>(() => {
  if (themeProfile.value === null) return true;
  return contentCollectionIds.value.includes(kind.value);
});

/** 顶部提示条（只读 > 不支持 > 落点被拒 > 内容仓提示） */
const hint = computed<{ tone: 'info' | 'warning' | 'error'; message: string; detail: string } | null>(
  () => {
    if (readOnly.value) {
      return {
        tone: 'warning',
        message: '当前内容源是 git 仓库：这里展示的是上次同步下来的工作副本，仅供查看。',
        detail:
          '写入会被拒绝（同步时工作副本会被强制检出并清理，写进去的内容必然丢失）。如需编辑，请把内容仓克隆到本地并把内容源改为 path 类型。',
      };
    }
    if (deniedMessage.value !== null) {
      return { tone: 'error', message: deniedMessage.value, detail: '' };
    }
    if (inContentRepo.value) {
      return {
        tone: 'info',
        message: `内容落在内容仓：${title.value}的增删改需要跑一次内容同步才会在主题中生效。`,
        detail: '',
      };
    }
    return null;
  },
);

/** 写操作是否可用（只读态 / 不支持 / 被拒 ⇒ 不可写） */
const writable = computed(
  () => !readOnly.value && !unsupported.value && deniedMessage.value === null && supported.value,
);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await contentApi.list({ kind: kind.value });
    items.value = result.items;
    readOnly.value = result.readOnly;
    inContentRepo.value = result.inContentRepo;
    deniedMessage.value = null;
    unsupported.value = false;
  } catch (err) {
    items.value = [];
    readOnly.value = false;
    inContentRepo.value = false;
    if (err instanceof ApiError && err.status === 404) {
      // 主题不支持该集合：这是「不存在」，不是错误 —— 给温和的说明而非红色报错
      unsupported.value = true;
      deniedMessage.value = null;
    } else if (err instanceof ApiError && err.status === 403) {
      deniedMessage.value = err.message;
    } else {
      ElMessage.error(err instanceof ApiError ? err.message : '加载失败');
    }
  } finally {
    loading.value = false;
  }
}

onMounted(load);
// 切换 kind（series ↔ moments）时重新加载
watch(kind, () => {
  void load();
});

/** 列表展示用的摘要列（首个非空文本字段，避免两集合各写一套表格） */
function summaryOf(item: ContentItem): string {
  for (const field of fields.value) {
    if (field.kind !== 'text') continue;
    const value = item.frontmatter[field.key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return item.content.slice(0, 60);
}

function openCreate(): void {
  editingSlug.value = null;
  formValues.value = {};
  formErrors.value = {};
  drawerOpen.value = true;
}

function openEdit(item: ContentItem): void {
  editingSlug.value = item.slug;
  // 只取写入口面里声明过的键 —— 未知键（passthrough 保留的自定义键）不在表单里出现，
  // 从而**不会**在保存时被无意覆盖或丢弃（后端合并语义会把它们原样保留）。
  const values: Record<string, unknown> = {};
  for (const field of fields.value) {
    values[field.key] = item.frontmatter[field.key] ?? undefined;
  }
  values['__content'] = item.content;
  formValues.value = values;
  formErrors.value = {};
  drawerOpen.value = true;
}

/** 配图行操作（moments 专用） */
function imagesOf(): MomentImage[] {
  const raw = formValues.value['images'];
  return Array.isArray(raw) ? (raw as MomentImage[]) : [];
}

function addImage(): void {
  formValues.value['images'] = [...imagesOf(), { src: '' }];
}

function removeImage(index: number): void {
  formValues.value['images'] = imagesOf().filter((_, i) => i !== index);
}

/** 标签输入（el-select allow-create 的值即字符串数组） */
function tagsOf(): string[] {
  const raw = formValues.value['tags'];
  return Array.isArray(raw) ? (raw as string[]) : [];
}

/**
 * 组装 frontmatter：**只提交写入口面里声明过的键，且跳过空值**。
 *
 * 「跳过空值」是刻意的：写入口面**没有默认值**，缺键就是缺键；
 * 若把空串/空数组提交上去，会把用户文件里的键**物化**出来（与构造面的污染方向相反，
 * 但同样是「面板替用户改文件」）。
 */
function buildFrontmatter(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields.value) {
    const value = formValues.value[field.key];
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (field.kind === 'images') {
      const rows = (value as MomentImage[]).filter((row) => row.src.trim() !== '');
      if (rows.length === 0) continue;
      out[field.key] = rows;
      continue;
    }
    out[field.key] = value;
  }
  return out;
}

/** 客户端必填预检（后端仍会校验；这里只是省一次往返与一次报错） */
function validateRequired(): boolean {
  const errors: Record<string, string> = {};
  for (const field of fields.value) {
    if (!field.required) continue;
    const value = formValues.value[field.key];
    if (value === undefined || value === null || value === '') {
      errors[field.key] = `${field.label}为必填项`;
    }
  }
  formErrors.value = errors;
  return Object.keys(errors).length === 0;
}

async function save(): Promise<void> {
  if (!validateRequired()) return;
  const slug = editingSlug.value;
  const content = typeof formValues.value['__content'] === 'string' ? (formValues.value['__content'] as string) : '';
  saving.value = true;
  try {
    let meta: ContentWriteMeta;
    if (slug === null) {
      // 新建：slug 从标题派生（单段名，禁路径分隔符）；用户可在确认框里改
      const derived = deriveSlug();
      if (derived === '') {
        formErrors.value['title'] = '无法从标题生成文件名，请填写标题';
        return;
      }
      const created = await contentApi.create(kind.value, {
        slug: derived,
        frontmatter: buildFrontmatter(),
        content,
      });
      meta = created;
      ElMessage.success(`${title.value}已创建：${created.slug}`);
    } else {
      const updated = await contentApi.update(kind.value, slug, {
        frontmatter: buildFrontmatter(),
        content,
      });
      meta = updated;
      ElMessage.success(`${title.value}已保存`);
    }
    lastWriteNeedsSync.value = meta.needsSync;
    drawerOpen.value = false;
    await load();
  } catch (err) {
    if (err instanceof ApiError && err.status === 400) {
      // 字段级错误尽量标到具体项；标不上就整体提示（不吞）
      const detail = err.detail as { issues?: { path?: string; message?: string }[] } | null;
      const mapped: Record<string, string> = {};
      for (const issue of detail?.issues ?? []) {
        if (typeof issue.path === 'string' && issue.path !== '') {
          mapped[issue.path] = issue.message ?? '校验失败';
        }
      }
      formErrors.value = mapped;
      ElMessage.error(err.message);
      return;
    }
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      // 保存那一刻才发现不可写：把服务端指路牌**常驻**到页面顶部，并关掉抽屉
      deniedMessage.value = err.message;
      drawerOpen.value = false;
      return;
    }
    ElMessage.error(err instanceof ApiError ? err.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

/** slug 派生：取首个文本字段值，保留中日韩与字母数字，其余转连字符 */
function deriveSlug(): string {
  const source = fields.value
    .filter((f) => f.kind === 'text')
    .map((f) => formValues.value[f.key])
    .find((v): v is string => typeof v === 'string' && v.trim() !== '');
  if (source === undefined) return '';
  return source
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function remove(item: ContentItem): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定删除「${item.slug}」？删除前会自动备份，可在「备份」页恢复。`,
      `删除${title.value}`,
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    );
  } catch {
    return; // 用户取消
  }
  try {
    const result = await contentApi.remove(kind.value, item.slug);
    lastWriteNeedsSync.value = result.needsSync;
    ElMessage.success('已删除（可在备份页恢复）');
    await load();
  } catch (err) {
    ElMessage.error(err instanceof ApiError ? err.message : '删除失败');
  }
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return `共 ${value.length} 项`;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/** moments 的 published 在 YAML 里可能是 Date，展示时统一成日期 */
function displayDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return '—';
}

void router; // 保留 router（将来跳详情页用），避免 lint 未使用告警</script>

<template>
  <div class="content-collection-page panel-card">
    <div class="page-header">
      <div class="header-title-wrap">
        <span class="header-desc">{{ description }}</span>
      </div>
      <div class="header-actions">
        <ContentSyncButton :needs-sync="lastWriteNeedsSync" />
        <el-button v-if="writable" type="primary" class="btn-gradient-primary" @click="openCreate">
          新建{{ title }}
        </el-button>
      </div>
    </div>

    <ContentWriteHint
      v-if="hint !== null"
      :tone="hint.tone"
      :message="hint.message"
      :detail="hint.detail"
    />

    <!-- 主题不支持该集合：温和说明 + 指路，不显示红色报错 -->
    <el-empty
      v-if="unsupported"
      :description="`当前主题没有「${title}」这个概念（series / moments 是 Shirone 主题独有的内容集合）`"
    >
      <el-button @click="router.push('/')">返回仪表盘</el-button>
    </el-empty>

    <el-table v-else v-loading="loading" :data="items" stripe>
      <el-table-column prop="slug" label="文件名" min-width="160" />
      <el-table-column label="摘要" min-width="220">
        <template #default="{ row }">{{ summaryOf(row) }}</template>
      </el-table-column>
      <el-table-column v-if="kind === 'moments'" label="发布时间" width="130">
        <template #default="{ row }">{{ displayDate(row.frontmatter.published) }}</template>
      </el-table-column>
      <el-table-column v-for="field in fields.slice(1, 3)" :key="field.key" :label="field.label" width="140">
        <template #default="{ row }">{{ formatValue(row.frontmatter[field.key]) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="170" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="openEdit(row)">{{ writable ? '编辑' : '查看' }}</el-button>
          <el-button v-if="writable" size="small" type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty :description="`还没有${title}`" />
      </template>
    </el-table>

    <!-- 编辑抽屉：字段表驱动 -->
    <el-drawer
      v-model="drawerOpen"
      :title="editingSlug === null ? `新建${title}` : `${writable ? '编辑' : '查看'}${title}：${editingSlug}`"
      size="560px"
    >
      <el-form label-position="top" :disabled="!writable">
        <el-form-item
          v-for="field in fields"
          :key="field.key"
          :label="field.label"
          :required="field.required"
          :error="formErrors[field.key]"
        >
          <el-input
            v-if="field.kind === 'text'"
            v-model="formValues[field.key] as string"
            :placeholder="field.placeholder"
          />
          <el-date-picker
            v-else-if="field.kind === 'date'"
            v-model="formValues[field.key] as string"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择日期"
            style="width: 100%"
          />
          <el-select
            v-else-if="field.kind === 'select'"
            v-model="formValues[field.key] as string"
            clearable
            placeholder="未设置"
            style="width: 100%"
          >
            <el-option
              v-for="opt in field.options ?? []"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <el-switch v-else-if="field.kind === 'boolean'" v-model="formValues[field.key] as boolean" />
          <el-select
            v-else-if="field.kind === 'tags'"
            :model-value="tagsOf()"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="输入后回车添加"
            style="width: 100%"
            @update:model-value="(v: string[]) => (formValues[field.key] = v)"
          />
          <div v-else-if="field.kind === 'images'" class="images-editor">
            <div v-for="(img, index) in imagesOf()" :key="index" class="images-editor__row">
              <el-input v-model="img.src" placeholder="src，如 /images/a.jpg" />
              <el-input v-model="img.alt" placeholder="alt（可选）" />
              <el-button text type="danger" @click="removeImage(index)">移除</el-button>
            </div>
            <el-button size="small" @click="addImage">添加一张</el-button>
          </div>
          <div v-if="field.help !== undefined" class="field-help">{{ field.help }}</div>
        </el-form-item>

        <el-form-item label="正文（Markdown，可选）">
          <el-input
            v-model="formValues['__content'] as string"
            type="textarea"
            :rows="8"
            placeholder="该内容项的 Markdown 正文"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="drawerOpen = false">{{ writable ? '取消' : '关闭' }}</el-button>
        <el-button v-if="writable" type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.header-desc {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.images-editor {
  width: 100%;
}

.images-editor__row {
  display: grid;
  grid-template-columns: 2fr 1fr auto;
  gap: 8px;
  margin-bottom: 8px;
}

.field-help {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
  line-height: 1.5;
}
</style>
