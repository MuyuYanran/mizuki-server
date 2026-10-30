/**
 * [T6a] 主题能力感知状态（菜单显隐 / 操作可用性 / 同步任务选择的**唯一判定源**）
 *
 * [职责] 登录后拉取 `GET /admin/theme/profile` 与 `GET /admin/theme/content-capabilities`，
 *   把「当前主题是什么、支持什么」暴露为响应式状态，供布局与各页消费。
 *
 * [为什么必须有一个 store 而不是各页自己拉]
 *   同一份能力判定要被**多处**消费（左侧导航显隐、文章列表的同步按钮、文章/动态页的
 *   只读横幅、集合页的类型列表）。若各页各自请求并各自写 if/else，会立刻分叉：
 *   加一档主题就要改 N 处，且极易出现「导航隐藏了但页面还能进」这类不一致。
 *   ⇒ 判定收敛到本文件一处，页面**只读**它。
 *
 * [失败语义：fail-open] 请求失败 ⇒ 能力置 null ⇒ 各消费点按「未知档」处理：
 *   - 导航：**显示全部**（宁可多显示，也不让用户找不到入口）；
 *   - 同步按钮：**两个都不显示**（因为无从判断该跑哪一个 —— 跑错的那个必定失败，
 *     属「静默失败的假操作」，比不显示更坏）；
 *   - 只读横幅：**不显示**（无从判断，不误报）。
 *   绝不抛错阻塞登录（与 stores/system.ts 的 R2-5 同一条纪律）。
 *
 * [与 stores/system.ts 的关系] 两者正交：system 管**运行模式**（manage/additive/overwrite，
 *   决定富文本文章等菜单的收窄），本 store 管**主题档位与能力面**（决定集合类型、
 *   同步任务名、只读态）。互不覆盖，各自 fail-open。
 *
 * [状态] ACTIVE
 */
import { computed, ref } from 'vue';
import type { ContentCapabilitySummary, ThemeAdapterProfileView, ThemeKind } from '@mizuki/shared';
import { themeApi } from '../api/theme';
import { isLoggedIn } from './auth';

/** 主题识别画像（null = 未加载 / 加载失败 ⇒ fail-open） */
export const themeProfile = ref<ThemeAdapterProfileView | null>(null);

/** 内容能力速查（null = 未加载 / 加载失败） */
export const contentCapabilities = ref<ContentCapabilitySummary | null>(null);

/** 是否已尝试加载完成（失败也置 true，避免每页轮询） */
export const themeCapabilitiesLoaded = ref(false);

let inflight: Promise<void> | null = null;

/** 当前主题档位（null = 未知） */
export const themeKind = computed<ThemeKind | null>(() => themeProfile.value?.kind ?? null);

/**
 * 当前主题是否为 Shirone。
 * `false` 涵盖「确定不是 Shirone」与「尚未加载 / 加载失败」两种情形。
 * ⚠ 因此**不要**用它做「隐藏 Shirone 专属功能」之外的判断 ——
 * 需要区分「确定不支持」与「未知」时，用 `isUnknownTheme` 或直接读 `themeKind`。
 */
export const isShironeTheme = computed<boolean>(() => themeKind.value === 'shirone');

/** 主题档位是否**确定**未知（与「尚未加载」区分：加载中也算 true，因 fail-open 同向） */
export const isUnknownTheme = computed<boolean>(
  () => themeKind.value === null || themeKind.value === 'unknown',
);

/**
 * 内容集合（series / moments）是否可用。
 * 由**能力面**决定而非档位名：这样将来别的主题若也支持同名集合，无需改前端。
 */
export const supportsContentCollections = computed<boolean>(
  () => themeProfile.value?.capabilities.contentCollections.supported ?? false,
);

/** 可用的内容集合 id 列表（如 `['series','moments']`） */
export const contentCollectionIds = computed<readonly string[]>(
  () => themeProfile.value?.capabilities.contentCollections.ids ?? [],
);

/** 当前主题可纳管的集合类型（决定左侧导航的「集合」分组显示哪些） */
export const availableCollections = computed<readonly string[]>(
  () => themeProfile.value?.capabilities.dataFiles.collections ?? [],
);

/** 可纳管的文章扩展名（如 `['.md','.mdx']`） */
export const postExtensions = computed<readonly string[]>(
  () => themeProfile.value?.capabilities.posts.extensions ?? [],
);

/** 内容能力一句话摘要（导航底部或页头展示） */
export const contentHeadline = computed<string>(() => contentCapabilities.value?.headline ?? '');

/**
 * 当前主题应使用的**内容同步任务名**；null ⇒ 无从判断（不显示任何同步按钮）。
 *
 * [为什么按档位而不是「有 needsSync 就都显示」]
 *   同一个概念在两家上游的脚本名**完全不同**（实测上游 package.json）：
 *     · Mizuki HEAD → `sync-content`（`node scripts/sync-content.js`）
 *     · Shirone     → `content:sync`（`node scripts/content/sync.mjs`）
 *   两个按钮同时显示会让用户去点那个注定失败的一个 —— 属「假操作」。
 *   ⇒ 按档位**单显**，且未知档一律不显示（宁可没有按钮，也不给一个点了报错的）。
 */
export const contentSyncTask = computed<'sync-content' | 'content:sync' | null>(() => {
  const kind = themeKind.value;
  const strategy = themeProfile.value?.capabilities.config.strategy;
  if (kind === 'shirone') return 'content:sync';
  // Mizuki HEAD 的判据用 config.strategy（overlay-ts）而非档位名 —— legacy 与 HEAD 同为 kind=mizuki
  if (kind === 'mizuki' && strategy === 'overlay-ts') return 'sync-content';
  return null;
});

/** 该档是否使用内容分离（决定写操作后是否需要提示「跑一次同步」） */
export const usesContentSeparation = computed<boolean>(() => {
  const strategy = themeProfile.value?.capabilities.config.strategy;
  return strategy === 'overlay-ts' || strategy === 'overlay-yaml';
});

/**
 * 确保能力已加载（幂等）：已登录且未加载过时拉取。
 *
 * 两个请求并发；**任一失败不影响另一个**（用 allSettled 而非 all）：
 * profile 拿到而 capabilities 失败时，导航显隐仍能正确工作（只是缺 headline）。
 * 全部失败 ⇒ 两者保持 null ⇒ fail-open。
 */
export async function ensureThemeCapabilities(): Promise<void> {
  if (themeCapabilitiesLoaded.value || !isLoggedIn()) {
    return;
  }
  inflight ??= Promise.allSettled([themeApi.getProfile(), themeApi.getContentCapabilities()])
    .then(([profileResult, capsResult]) => {
      if (profileResult.status === 'fulfilled') {
        themeProfile.value = profileResult.value;
      }
      if (capsResult.status === 'fulfilled') {
        contentCapabilities.value = capsResult.value;
      }
    })
    .finally(() => {
      themeCapabilitiesLoaded.value = true;
      inflight = null;
    });
  return inflight;
}

/** 强制重新拉取（主题根在设置页被改后调用；幂等无副作用） */
export async function refreshThemeCapabilities(): Promise<void> {
  themeCapabilitiesLoaded.value = false;
  themeProfile.value = null;
  contentCapabilities.value = null;
  await ensureThemeCapabilities();
}

/** 登出/会话失效时复位（下次登录重新拉取） */
export function resetThemeCapabilities(): void {
  themeProfile.value = null;
  contentCapabilities.value = null;
  themeCapabilitiesLoaded.value = false;
}

/**
 * [T6a] 集合类型 → 中文名（导航与页头共用）。
 * 与后端 registry 的集合键一一对应；未知键回退为键名本身（不显示空白）。
 */
export const COLLECTION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  diary: '日记',
  friends: '友链',
  projects: '项目',
  timeline: '时间线',
  skills: '技能',
  devices: '设备',
  anime: '番剧',
  compass: '指南针',
  games: '游戏',
  music: '音乐',
});

export function collectionLabel(type: string): string {
  return COLLECTION_LABELS[type] ?? type;
}
