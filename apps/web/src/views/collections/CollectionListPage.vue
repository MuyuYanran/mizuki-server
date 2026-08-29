<script setup lang="ts">
/**
 * [P10b] 六类集合通用列表页（按路由参数 :type 实例化）
 * [职责] 一个组件复用于 diary/friends/projects/timeline/skills/devices：
 *   - array 形：表格展示条目，新增/编辑/删除；
 *   - grouped 形（devices）：先选分组再展示条目，新增带 group 字段，
 *     删除后重新拉取（空分组由后端清理）。
 * 字段列与表单全部由 @mizuki/shared 的 zod schema 驱动（mapper.ts 推导），
 * 不为六类手写重复结构（P4 放 schema 到 shared 的动机在此兑现）。
 * [状态] ACTIVE
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { z, type ZodObject, type ZodType } from 'zod';
import {
  DeviceItemSchema,
  DiaryItemSchema,
  FriendsItemSchema,
  ProjectsItemSchema,
  SkillsItemSchema,
  TimelineItemSchema,
} from '@mizuki/shared';
import {
  collectionsApi,
  extractFieldIssues,
  isGrouped,
  type CollectionItem,
  type CollectionType,
  type GroupedItems,
} from '../../api/collections';
import { ApiError } from '../../api/http';
import { SchemaForm, describeSchema, emptyValueFromSchema, type FieldDescriptor } from '../../lib/schema-form';
import ImageUploader from '../../components/ImageUploader.vue';
import CropperUploader from '../../components/CropperUploader.vue';
import type { MediaInfo } from '../../api/media';

/** 单类集合的渲染配置（与后端 registry 对齐，schema 实例复用 shared 导出） */
interface CollectionConfig {
  type: CollectionType;
  title: string;
  schema: ZodObject<Record<string, ZodType>>;
  idField: string;
  shape: 'array' | 'grouped';
}

/** 七类配置（顺序即菜单顺序；idField/shape 与后端 registry 逐字对齐） */
const CONFIGS: CollectionConfig[] = [
  { type: 'diary', title: '日记', schema: DiaryItemSchema, idField: 'id', shape: 'array' },
  { type: 'friends', title: '友链', schema: FriendsItemSchema, idField: 'id', shape: 'array' },
  { type: 'projects', title: '项目', schema: ProjectsItemSchema, idField: 'id', shape: 'array' },
  { type: 'timeline', title: '时间线', schema: TimelineItemSchema, idField: 'id', shape: 'array' },
  { type: 'skills', title: '技能', schema: SkillsItemSchema, idField: 'id', shape: 'array' },
  { type: 'devices', title: '设备', schema: DeviceItemSchema, idField: 'name', shape: 'grouped' },
];

const CONFIG_BY_TYPE = new Map<CollectionType, CollectionConfig>(
  CONFIGS.map((c) => [c.type, c]),
);

const route = useRoute();
const router = useRouter();

/** 当前路由参数对应的配置（非法 type → null，渲染 404 占位） */
const config = computed<CollectionConfig | null>(() => {
  const type = route.params['type'];
  if (typeof type !== 'string') {
    return null;
  }
  return CONFIG_BY_TYPE.get(type as CollectionType) ?? null;
});

/** 表格列描述符（取 schema 顶层字段；长文本/数组字段截断展示） */
const columns = computed<FieldDescriptor[]>(() => {
  if (config.value === null) {
    return [];
  }
  return describeSchema(config.value.schema);
});

/** 取字段显示值（长文本截断、数组用逗号拼、对象略写） */
function cellText(item: CollectionItem, col: FieldDescriptor): string {
  const value = item[col.key];
  if (value === undefined || value === null) {
    return '';
  }
  if (Array.isArray(value)) {
    // 对象数组（如 timeline.links）无法逗号拼接，转 JSON 略写
    return value.every((v) => typeof v === 'string') ? value.join(', ') : JSON.stringify(value);
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  const str = String(value);
  return str.length > 40 ? `${str.slice(0, 40)}…` : str;
}

/** 列表数据 */
const list = ref<CollectionItem[]>([]);
/** grouped 数据（devices） */
const grouped = ref<GroupedItems>({});
/** 当前选中的分组（devices） */
const activeGroup = ref<string>('');
/** grouped 的分组名列表 */
const groupNames = computed<string[]>(() => Object.keys(grouped.value).sort());

/** 加载/提交状态 */
const loading = ref(false);
const submitting = ref(false);

/** 抽屉表单：是否可见、是否编辑态、当前编辑条目 id、表单值 */
const drawerVisible = ref(false);
const isEdit = ref(false);
const editingId = ref<string>('');
const formValue = ref<Record<string, unknown>>({});
/** 后端返回的字段错误（detail.issues 映射） */
const serverErrors = ref<Record<string, string>>({});

/** 拉取列表 */
async function fetchList(): Promise<void> {
  if (config.value === null) {
    return;
  }
  loading.value = true;
  try {
    const data = await collectionsApi.list<unknown>(config.value.type);
    if (config.value.shape === 'grouped') {
      if (isGrouped(data)) {
        grouped.value = data;
        if (activeGroup.value === '' || !(activeGroup.value in data)) {
          const first = Object.keys(data).sort()[0];
          activeGroup.value = first ?? '';
        }
        list.value = activeGroup.value === '' ? [] : (data[activeGroup.value] ?? []);
      } else {
        grouped.value = {};
        list.value = [];
      }
    } else {
      list.value = Array.isArray(data) ? (data as CollectionItem[]) : [];
    }
  } catch (e) {
    handleError(e, '加载列表失败');
  } finally {
    loading.value = false;
  }
}

/** 切换分组（devices） */
function switchGroup(group: string): void {
  activeGroup.value = group;
  list.value = grouped.value[group] ?? [];
}

/** 新增：打开抽屉，表单初值取 schema 空值 */
function openCreate(): void {
  if (config.value === null) {
    return;
  }
  isEdit.value = false;
  editingId.value = '';
  formValue.value = emptyValueFromSchema(config.value.schema);
  // grouped 新增：预填当前选中分组（后端要求 body 含 group）
  if (config.value.shape === 'grouped' && activeGroup.value !== '') {
    formValue.value['group'] = activeGroup.value;
  }
  serverErrors.value = {};
  drawerVisible.value = true;
}

/** 编辑：打开抽屉，预填现值（深拷贝避免双向引用） */
function openEdit(item: CollectionItem): void {
  if (config.value === null) {
    return;
  }
  isEdit.value = true;
  editingId.value = String(item[config.value.idField] ?? '');
  formValue.value = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
  serverErrors.value = {};
  drawerVisible.value = true;
}

/**
 * [P10d] 快速上传图片：上传后按字段回填（diary.images 追加、
 * projects/devices.image 设置；无图片字段的 type 提示复制路径）。
 * 不改 SchemaForm 既有交互（文本输入仍在，上传为辅助入口）。
 */
function onImageUploaded(media: MediaInfo): void {
  const fm = formValue.value;
  if (Array.isArray(fm['images'])) {
    formValue.value = { ...fm, images: [...(fm['images'] as string[]), media.path] };
    ElMessage.success(`已添加到图片列表：${media.path}`);
  } else if ('image' in fm) {
    formValue.value = { ...fm, image: media.path };
    ElMessage.success(`已设置图片：${media.path}`);
  } else {
    ElMessage.info(`图片已上传：${media.path}（请手动填入对应字段）`);
  }
}

/**
 * [Phase2-B1 / R2-6] 友链头像裁切上传：CropperUploader（圆形 1:1）
 * 上传后回填 imgurl 字段（手动粘贴外链 URL 的输入仍保留）。
 */
function onAvatarUploaded(media: MediaInfo): void {
  formValue.value = { ...formValue.value, imgurl: media.path };
  ElMessage.success(`已设置头像：${media.path}`);
}

/** 提交：SchemaForm 内部已跑过 schema.parse，此处只发请求 */
async function onSubmit(value: Record<string, unknown>): Promise<void> {
  if (config.value === null) {
    return;
  }
  submitting.value = true;
  serverErrors.value = {};
  try {
    if (isEdit.value) {
      await collectionsApi.update(config.value.type, editingId.value, value);
      ElMessage.success('已保存');
    } else {
      await collectionsApi.create(config.value.type, value);
      ElMessage.success('已新增');
    }
    drawerVisible.value = false;
    await fetchList();
  } catch (e) {
    // 后端 400 校验错误 → 字段级提示
    if (e instanceof ApiError && e.status === 400) {
      const issues = extractFieldIssues(e.detail);
      if (issues.length > 0) {
        const map: Record<string, string> = {};
        for (const issue of issues) {
          if (map[issue.path] === undefined) {
            map[issue.path] = issue.message;
          }
        }
        serverErrors.value = map;
      } else {
        ElMessage.error(e.message);
      }
    } else {
      handleError(e, isEdit.value ? '保存失败' : '新增失败');
    }
  } finally {
    submitting.value = false;
  }
}

/** 删除：二次确认 → DELETE → 刷新 */
async function onDelete(item: CollectionItem): Promise<void> {
  if (config.value === null) {
    return;
  }
  const id = String(item[config.value.idField] ?? '');
  try {
    await ElMessageBox.confirm(`确定删除 ${config.value.title}「${id}」？`, '删除确认', {
      type: 'warning',
    });
  } catch {
    return; // 用户取消
  }
  try {
    await collectionsApi.remove(config.value.type, id);
    ElMessage.success('已删除');
    await fetchList();
  } catch (e) {
    handleError(e, '删除失败');
  }
}

/** 统一错误提示（非 400 字段错误的兜底） */
function handleError(e: unknown, fallback: string): void {
  if (e instanceof ApiError) {
    ElMessage.error(e.message);
  } else {
    ElMessage.error(fallback);
  }
}

/** 路由参数变化时重新拉取 */
watch(
  () => route.params['type'],
  () => {
    if (config.value !== null) {
      void fetchList();
    }
  },
);

/** 分组变化时同步当前展示列表 */
watch(activeGroup, (g) => {
  if (config.value?.shape === 'grouped') {
    list.value = grouped.value[g] ?? [];
  }
});

onMounted(() => {
  if (config.value !== null) {
    void fetchList();
  }
});

/** 路由非法 type → 提示并回主页 */
function goHome(): void {
  void router.push('/');
}
</script>

<template>
  <el-card v-if="config === null">
    <el-empty description="未知的集合类型">
      <el-button @click="goHome">返回主页</el-button>
    </el-empty>
  </el-card>

  <el-card v-else v-loading="loading">
    <template #header>
      <div class="card-header">
        <span>{{ config.title }}</span>
        <el-button type="primary" @click="openCreate">新增</el-button>
      </div>
    </template>

    <!-- grouped（devices）：分组选择器 -->
    <div v-if="config.shape === 'grouped'" class="group-bar">
      <span>分组：</span>
      <el-select v-model="activeGroup" placeholder="请选择分组" @change="switchGroup" class="group-select">
        <el-option v-for="g in groupNames" :key="g" :label="g || '（空）'" :value="g" />
      </el-select>
    </div>

    <el-table :data="list" border class="list-table">
      <el-table-column
        v-for="col in columns"
        :key="col.key"
        :prop="col.key"
        :label="col.label"
        :width="col.readOnly ? 80 : undefined"
      >
        <template #default="{ row }">{{ cellText(row, col) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="openEdit(row)">编辑</el-button>
          <el-button size="small" type="danger" @click="onDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 新增/编辑抽屉表单 -->
    <el-drawer v-model="drawerVisible" :title="isEdit ? `编辑${config.title}` : `新增${config.title}`" size="500px">
      <div class="quick-upload">
        <span class="quick-label">快速上传图片：</span>
        <ImageUploader label="上传" @uploaded="onImageUploaded" />
        <!-- [R2-6] 友链头像：裁切（圆形 1:1）→ 上传 → 回填 imgurl -->
        <CropperUploader
          v-if="config.type === 'friends'"
          label="裁切上传头像"
          :fixed-number="[1, 1]"
          :round="true"
          @uploaded="onAvatarUploaded"
        />
      </div>
      <SchemaForm
        v-if="drawerVisible"
        :schema="config.schema"
        v-model="formValue"
        :submit-label="isEdit ? '保存' : '新增'"
        :loading="submitting"
        :server-errors="serverErrors"
        @submit="onSubmit"
        @cancel="drawerVisible = false"
      />
    </el-drawer>
  </el-card>
</template>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.group-bar {
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.group-select {
  width: 220px;
}
.list-table {
  width: 100%;
}
.quick-upload {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
}
.quick-label {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
