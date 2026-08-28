/**
 * [Phase2-B1 / R2-5] 系统运行模式状态（菜单过滤判定源）
 * [职责] 登录后拉取 /admin/system/status 的 mode 字段（一次/会话），
 *   供 MainLayout 菜单过滤与路由守卫重定向消费。
 * 纪律（R2-5 / B1 §3 逐字）：
 *  - 请求失败或字段缺失 → mode 置 null（未知）→ fail-open 显示全部，
 *    绝不抛错阻塞登录；
 *  - 后端 mode 枚举为 manage/additive/overwrite；「minimal（仅管理）」
 *    即向导选项一 manage（仅管理模式）——本映射记 B1 交付报告疑问清单；
 *    若未来出现字面 'minimal' 值同样命中过滤（规格原文如此）。
 * [状态] ACTIVE
 */
import { ref } from 'vue';
import { systemApi } from '../api/system';
import { isLoggedIn } from './auth';

/** 过滤命中的模式值（R2-5「minimal（仅管理）」） */
const MINIMAL_MODE_VALUES = new Set(['manage', 'minimal']);

/** 当前系统模式（null = 未加载/未知 → fail-open） */
export const systemMode = ref<string | null>(null);

/** 模式是否已加载完成（本会话内只拉一次；失败也置 true 走 fail-open） */
export const systemModeLoaded = ref(false);

let inflight: Promise<void> | null = null;

/** minimal（仅管理）态判定：隐藏富文本文章菜单（[B2/裁决 7] 收窄后六类集合保留） */
export function isMinimalMode(): boolean {
  return systemMode.value !== null && MINIMAL_MODE_VALUES.has(systemMode.value);
}

/**
 * 确保模式已加载（幂等）：已登录且未加载过时拉取 status。
 * 失败静默（mode 保持 null → fail-open），不抛出。
 */
export async function ensureSystemMode(): Promise<void> {
  if (systemModeLoaded.value || !isLoggedIn()) {
    return;
  }
  inflight ??= systemApi
    .status()
    .then((status) => {
      systemMode.value = typeof status.mode === 'string' && status.mode !== '' ? status.mode : null;
    })
    .catch(() => {
      systemMode.value = null; // fail-open（避免误伤，R2-5 逐字）
    })
    .finally(() => {
      systemModeLoaded.value = true;
      inflight = null;
    });
  return inflight;
}

/** 登出/会话失效时复位（下次登录重新拉取） */
export function resetSystemMode(): void {
  systemMode.value = null;
  systemModeLoaded.value = false;
}
