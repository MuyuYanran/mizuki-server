/**
 * [Phase2-B1 / R2-1] 主题偏好三态管理（浅色 → 深色 → 跟随 system）
 * [职责]
 *  - 偏好持久化 localStorage（键 mizuki.theme，R2-1 逐字）；
 *  - 解析后的实际主题驱动 html.dark 类（Element Plus 官方 dark 模式入口）；
 *  - auto 态监听 prefers-color-scheme 变化实时切换；
 *  - index.html 内联脚本在 CSS 首帧前设置 dark 类避免闪白（FOUC），
 *    本模块在应用启动后接管（initTheme）。
 * [状态] ACTIVE
 */
import { computed, ref, watch } from 'vue';

export type ThemePreference = 'light' | 'dark' | 'auto';

export const THEME_KEY = 'mizuki.theme';

/** 循环顺序（B1 §3：浅色 → 深色 → 跟随 system） */
const CYCLE: ThemePreference[] = ['light', 'dark', 'auto'];

export const THEME_LABELS: Record<ThemePreference, string> = {
  light: '浅色',
  dark: '深色',
  auto: '跟随系统',
};

function readPreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'dark' || stored === 'auto' || stored === 'light' ? stored : 'light';
}

const media = window.matchMedia('(prefers-color-scheme: dark)');

/** 当前偏好（三态） */
export const themePreference = ref<ThemePreference>(readPreference());

/** 解析后的实际主题（auto 依系统） */
export const resolvedTheme = computed<'light' | 'dark'>(() => {
  if (themePreference.value === 'auto') {
    return media.matches ? 'dark' : 'light';
  }
  return themePreference.value;
});

/** 应用到 DOM（html.dark） */
function applyTheme(): void {
  document.documentElement.classList.toggle('dark', resolvedTheme.value === 'dark');
}

/** 偏好变化 / 系统主题变化 → 重新应用 */
watch(resolvedTheme, applyTheme);
media.addEventListener('change', () => {
  if (themePreference.value === 'auto') {
    applyTheme();
  }
});

/** 设置偏好（持久化 + 立即生效；light 也显式落键，便于核验持久化行为） */
export function setTheme(preference: ThemePreference): void {
  themePreference.value = preference;
  localStorage.setItem(THEME_KEY, preference);
}

/** 三态循环切换（顶栏按钮） */
export function cycleTheme(): void {
  const index = CYCLE.indexOf(themePreference.value);
  setTheme(CYCLE[(index + 1) % CYCLE.length] ?? 'light');
}

/** 应用启动时接管（index.html 内联脚本已先行设置过初始类） */
export function initTheme(): void {
  applyTheme();
}
