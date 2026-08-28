<script setup lang="ts">
/**
 * [P10d] 相册列表页面
 * [职责] 相册卡片列表（title/description/图片数）+ 创建对话框（info.json 全字段：
 *   title*(必填)、description、date、location、tags、layout、columns）。点击相册进入详情页。
 * [状态] ACTIVE
 */
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { albumsApi, type AlbumView, type AlbumInfo } from '../../api/albums';
import { todayString } from '../../lib/schema-form/mapper';
import { ApiError } from '../../api/http';

const router = useRouter();
const list = ref<AlbumView[]>([]);
const loading = ref(false);

/** 创建表单（全 string，提交时构造 AlbumInfo；optional 字段空串转 undefined） */
interface CreateForm {
  name: string;
  title: string;
  description: string;
  date: string;
  location: string;
  layout: string;
  /** [Phase3-C2a] 列数（el-input-number 1-6；null=继承默认 3） */
  columns: number | null;
  /** [Phase3-C2a] hidden:true 隐藏（不出现在公开列表，非访问控制） */
  hidden: boolean;
}

const createVisible = ref(false);
const creating = ref(false);
const createForm = ref<CreateForm>({
  name: '',
  title: '',
  description: '',
  date: todayString(),
  location: '',
  layout: '',
  columns: null,
  hidden: false,
});

async function fetchList(): Promise<void> {
  loading.value = true;
  try {
    list.value = await albumsApi.list();
  } catch (e) {
    handleError(e, '加载相册列表失败');
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  createForm.value = {
    name: '',
    title: '',
    description: '',
    date: todayString(),
    location: '',
    layout: '',
    columns: null,
    hidden: false,
  };
  createVisible.value = true;
}

function buildInfo(form: CreateForm): AlbumInfo {
  const info: AlbumInfo = { title: form.title };
  if (form.description !== '') info.description = form.description;
  if (form.date !== '') info.date = form.date;
  if (form.location !== '') info.location = form.location;
  if (form.layout !== '') info.layout = form.layout as AlbumInfo['layout'];
  if (form.columns !== null) info.columns = form.columns;
  if (form.hidden) info.hidden = true;
  return info;
}

/** [B3.6] 日期选择回调：el-date-picker 清空回调 null → 空串（保持 string 语义） */
function onDatePick(value: unknown): void {
  createForm.value.date = typeof value === 'string' ? value : '';
}

async function onCreate(): Promise<void> {
  if (createForm.value.name.trim() === '') {
    ElMessage.warning('请输入相册目录名');
    return;
  }
  if (createForm.value.title.trim() === '') {
    ElMessage.warning('请输入相册标题');
    return;
  }
  creating.value = true;
  try {
    await albumsApi.create({ name: createForm.value.name, info: buildInfo(createForm.value) });
    ElMessage.success('相册创建成功');
    createVisible.value = false;
    await fetchList();
  } catch (e) {
    handleError(e, '创建相册失败');
  } finally {
    creating.value = false;
  }
}

function openDetail(name: string): void {
  void router.push(`/albums/${encodeURIComponent(name)}`);
}

function handleError(e: unknown, fallback: string): void {
  if (e instanceof ApiError) {
    ElMessage.error(e.message);
  } else {
    ElMessage.error(fallback);
  }
}

onMounted(() => {
  void fetchList();
});
</script>

<template>
  <el-card v-loading="loading">
    <template #header>
      <div class="card-header">
        <span>相册</span>
        <el-button type="primary" @click="openCreate">创建相册</el-button>
      </div>
    </template>
    <el-row :gutter="12">
      <el-col v-for="album in list" :key="album.name" :span="6">
        <el-card class="album-card" @click="openDetail(album.name)">
          <div class="album-title">
            {{ album.info.title }}
            <!-- [Phase3-C2a] hidden 徽标：管理端可见、公开列表隐藏 -->
            <el-tag v-if="album.info.hidden === true" type="warning" size="small">已隐藏</el-tag>
          </div>
          <div class="album-desc">{{ album.info.description ?? '无描述' }}</div>
          <div class="album-meta">{{ album.images.length }} 张图片</div>
        </el-card>
      </el-col>
      <el-col v-if="list.length === 0" :span="24">
        <el-empty description="暂无相册" />
      </el-col>
    </el-row>

    <el-dialog v-model="createVisible" title="创建相册" width="500px">
      <el-form label-width="80px">
        <el-form-item label="目录名" required>
          <el-input v-model="createForm.name" placeholder="相册目录名（不含路径分隔符）" />
        </el-form-item>
        <el-form-item label="标题" required>
          <el-input v-model="createForm.title" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="createForm.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="日期">
          <!-- [B3.6] el-date-picker（YYYY-MM-DD）替代裸 el-input -->
          <el-date-picker
            :model-value="createForm.date || undefined"
            type="date"
            value-format="YYYY-MM-DD"
            format="YYYY-MM-DD"
            placeholder="选择日期"
            class="date-input"
            @update:model-value="onDatePick"
          />
        </el-form-item>
        <el-form-item label="位置">
          <el-input v-model="createForm.location" />
        </el-form-item>
        <!-- [Phase3-C2a] 布局/列数收紧：el-select 枚举 + el-input-number 1-6（可空=继承默认） -->
        <el-form-item label="布局">
          <el-select v-model="createForm.layout" clearable placeholder="grid / masonry" class="full-width">
            <el-option label="grid" value="grid" />
            <el-option label="masonry" value="masonry" />
          </el-select>
        </el-form-item>
        <el-form-item label="列数">
          <el-input-number v-model="createForm.columns" :min="1" :max="6" :controls="true" class="full-width" />
        </el-form-item>
        <el-form-item label="隐藏">
          <el-switch v-model="createForm.hidden" />
          <span class="field-hint">隐藏后不出现在公开相册列表（文件仍保留）</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="onCreate">创建</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.date-input {
  width: 100%;
}
.full-width {
  width: 100%;
}
.field-hint {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.album-card {
  cursor: pointer;
  margin-bottom: 12px;
}
.album-title {
  font-weight: 700;
  font-size: 15px;
}
.album-desc {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  margin: 4px 0;
}
.album-meta {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
