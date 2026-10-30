<script setup lang="ts">
/**
 * [T6a] 内容同步按钮（**按主题形态精准单显**）
 *
 * [职责] 在「写操作落在内容仓」的场景里，给用户一条把改动物化到主题的通道。
 *
 * [为什么必须单显而不是给出两个按钮]
 *   同一个概念在两家上游的脚本名**完全不同**（实测上游 `package.json`，非推断）：
 *     · Mizuki HEAD → `sync-content`（`node scripts/sync-content.js`）
 *     · Shirone     → `content:sync`（`node scripts/content/sync.mjs`）
 *   而两者**互不存在**：对 Mizuki 跑 `content:sync`、对 Shirone 跑 `sync-content`
 *   都会以「脚本不存在」失败。两个按钮并列，就是在请用户去点那个注定失败的一个 ——
 *   属「假操作」，比不显示更坏。
 *   ⇒ 任务名由 `stores/theme` 的 `contentSyncTask` 单点决定；未知档返回 null ⇒ 整条不渲染。
 *
 * [为什么还要 `needs-sync` 这个 prop]
 *   并非所有写操作都需要同步：Mizuki legacy 与 Shirone local 档下代码仓即真源，
 *   写完就已经生效。此时显示「需要同步」是误导。故由调用方按**本次操作的响应**
 *   传入（服务端在 external 档的写响应里带 `needsSync: true`）。
 *
 * [执行通道] 复用既有白名单任务链路（`POST /admin/process/tasks`），
 *   不引入任何新的执行面：固定无参 + `shell:false` + 不接受用户输入。
 */
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { processApi } from '../api/process';
import { contentSyncTask, usesContentSeparation } from '../stores/theme';

const props = withDefaults(
  defineProps<{
    /** 上一次写操作的响应是否要求同步（external 档为 true） */
    needsSync?: boolean;
    /** 按钮尺寸（跟随所在页面的操作簇） */
    size?: 'small' | 'default';
  }>(),
  { needsSync: false, size: 'default' },
);

const running = ref(false);

/** 是否应显示：任务名可判定（非未知档）才显示 */
const taskName = computed(() => contentSyncTask.value);
const visible = computed(() => taskName.value !== null);

/** 文案按档位区分，让用户知道自己在跑哪一条上游脚本 */
const label = computed(() =>
  taskName.value === 'sync-content' ? '同步内容（sync-content）' : '同步内容（content:sync）',
);

/** 是否需要强调（本次写操作落在内容仓、尚未物化） */
const emphasize = computed(() => props.needsSync && usesContentSeparation.value);

async function trigger(): Promise<void> {
  const task = taskName.value;
  if (task === null || running.value) return;
  running.value = true;
  try {
    await processApi.startTask(task);
    ElMessage.success('已启动内容同步任务（可在「构建预览」页查看实时日志）');
  } catch (error) {
    // 失败必须显式告知：同步失败意味着「写入未生效」，静默会让用户以为已经好了
    ElMessage.error(error instanceof Error ? error.message : '启动内容同步任务失败');
  } finally {
    running.value = false;
  }
}
</script>

<template>
  <el-button
    v-if="visible"
    :type="emphasize ? 'warning' : 'default'"
    :plain="!emphasize"
    :size="size"
    :loading="running"
    :title="emphasize ? '改动已写入内容仓，需要同步才会在主题中生效' : '把内容仓的改动物化到主题'"
    @click="trigger"
  >
    {{ label }}
  </el-button>
</template>
