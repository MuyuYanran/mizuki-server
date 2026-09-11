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
import { albumsApi, type AlbumView, type AlbumInfo, type ExternalPhoto } from '../../api/albums';
import { todayString } from '../../lib/schema-form/mapper';
import { ApiError } from '../../api/http';
import { notifyApiError } from '../../lib/notify';
import { dateOrEmpty } from '../../lib/format';

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
  /** [Phase4-D2/#6] 相册模式（local 缺省 / external 外链——主题渲染契约双路，ADR-022） */
  mode: 'local' | 'external';
  /** [Phase4-D2/#6] 外链模式封面（主题 album-scanner 对 external 相册必需） */
  cover: string;
  /** [Phase4-D2/#6] 批量外链图 URL（每行一个，空行忽略 → photos[{src}]） */
  photoUrls: string;
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
  mode: 'local',
  cover: '',
  photoUrls: '',
});

async function fetchList(): Promise<void> {
  loading.value = true;
  try {
    list.value = await albumsApi.list();
  } catch (e) {
    notifyApiError(e, '加载相册列表失败');
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
    mode: 'local',
    cover: '',
    photoUrls: '',
  };
  createVisible.value = true;
}

/** 批量外链 URL 行 → photos[{src}]（空行忽略；[Phase4-D2/#6]） */
function parsePhotoUrls(lines: string): ExternalPhoto[] {
  return lines
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((src) => ({ src }));
}

function buildInfo(form: CreateForm): AlbumInfo {
  const info: AlbumInfo = { title: form.title };
  if (form.description !== '') info.description = form.description;
  if (form.date !== '') info.date = form.date;
  if (form.location !== '') info.location = form.location;
  if (form.layout !== '') info.layout = form.layout as AlbumInfo['layout'];
  if (form.columns !== null) info.columns = form.columns;
  if (form.hidden) info.hidden = true;
  // [Phase4-D2/#6] 外链模式：mode + cover（主题必需）+ 批量 photos（src 写入口径
  // 由服务端收紧校验，http(s)/站点绝对路径合法）
  // [Phase4-D4/A2] photos **恒键**（走查②）：AlbumInfoExternalSchema.photos 为必键
  // （可为空数组），空 URL 时省键 → union 双分支全挂 400。按 mode 分支构造 body，
  // 外链分支恒发 photos（空数组 = 建册后经详情页增补的合法空态）。
  if (form.mode === 'external') {
    info.mode = 'external';
    info.cover = form.cover.trim();
    info.photos = parsePhotoUrls(form.photoUrls);
  }
  return info;
}

/** [B3.6] 日期选择回调：el-date-picker 清空回调 null → 空串（保持 string 语义） */
function onDatePick(value: unknown): void {
  createForm.value.date = dateOrEmpty(value);
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
  // [Phase4-D2/#6] 外链模式前端必填面（服务端 schema 亦校验）
  if (createForm.value.mode === 'external' && createForm.value.cover.trim() === '') {
    ElMessage.warning('外链模式相册必须填写封面地址（cover）');
    return;
  }
  creating.value = true;
  try {
    await albumsApi.create({ name: createForm.value.name, info: buildInfo(createForm.value) });
    ElMessage.success('相册创建成功');
    createVisible.value = false;
    await fetchList();
  } catch (e) {
    notifyApiError(e, '创建相册失败');
  } finally {
    creating.value = false;
  }
}

function openDetail(name: string): void {
  void router.push(`/albums/${encodeURIComponent(name)}`);
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
          <!-- [Phase4-D4/配套3→C4 批⑧改靶 2026-09-08] 缺封面警示真靶 = 本地半边：
               主题 album-scanner 对本地相册要求 cover.webp/cover.jpg（两者皆缺 →
               构建期剔除整个相册不上站）；外链半边 cover 系 schema 必填（缺失已被
               服务端校验剔除，警示不可达，原外链 tag 撤除——剔除系设计行为） -->
          <div class="album-meta">
            <template v-if="album.info.mode === 'external'">
              外链 · {{ album.info.photos?.length ?? 0 }} 张图片
            </template>
            <template v-else>
              {{ album.images.length }} 张图片
              <el-tag
                v-if="!album.images.includes('cover.webp') && !album.images.includes('cover.jpg')"
                type="danger"
                size="small"
              >缺封面</el-tag>
            </template>
          </div>
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
        <!-- [Phase4-D2/#6] 相册模式：外链模式 = 语义结果（mode + cover + photos），
             与主题 special-gallery 双路渲染契约对齐（ADR-022 实证） -->
        <el-form-item label="模式">
          <el-radio-group v-model="createForm.mode">
            <el-radio value="local">本地上传</el-radio>
            <el-radio value="external">外链图片</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="createForm.mode === 'external'" label="封面" required>
          <el-input v-model="createForm.cover" placeholder="https://... 或 /images/..." />
          <div class="field-hint">外链模式相册必须提供封面地址（主题渲染链必需）</div>
        </el-form-item>
        <el-form-item v-if="createForm.mode === 'external'" label="图片链接">
          <el-input
            v-model="createForm.photoUrls"
            type="textarea"
            :rows="4"
            placeholder="每行一个图片地址（http(s) URL 或 /images/...），创建后也可在详情页继续增补"
          />
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
