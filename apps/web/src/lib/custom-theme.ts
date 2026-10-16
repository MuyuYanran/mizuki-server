/**
 * [主题外观] 面板自定义主题：预设主题 + 用户上传/编辑 CSS
 * [职责] 纯前端自包含（零后端端点、零 Mizuki 主题文件写入）：
 *  - 预设主题：由主色程序化生成 Element Plus 主色阶（light-3..9 / dark-2），
 *    混色算法与 element/theme-chalk 官方一致（light-N = 主色 ×(10-N)/10 + 白 ×N/10；
 *    暗色阶底色 #141414；dark-2 = 主色 80% + 黑 20%），注入 <style> 后
 *    覆盖 theme.css 的同名变量；
 *  - 用户自定义 CSS：原文注入 <style id="mizuki-custom-theme-style">（head 末尾，
 *    晚于 theme.css 加载，可覆盖任意变量，含 --mizuki-* 与 --el-*）；
 *  - 持久化 localStorage（键 mizuki.customTheme.active / mizuki.customTheme.items）；
 *  - index.html 内联脚本在首帧前注入已激活主题避免闪烁，本模块启动后接管
 *    （initCustomTheme，与 lib/theme.ts 的 initTheme 同型分工）。
 * [状态] ACTIVE
 */

/** 自定义主题条目（localStorage 持久化形态） */
export interface CustomThemeItem {
  id: string;
  name: string;
  /** 原始 CSS 文本（用户可覆盖任意变量） */
  css: string;
  updatedAt: number;
}

/** 预设主题定义（css 由 generatePresetCss 程序化生成，不落盘） */
export interface PresetTheme {
  id: string;
  name: string;
  /** 主色（亮色） */
  primary: string;
  /** 主色（暗色） */
  darkPrimary: string;
  description: string;
}

const ACTIVE_KEY = 'mizuki.customTheme.active';
const ITEMS_KEY = 'mizuki.customTheme.items';

/** 注入节点的 id（index.html 内联脚本与本模块共用） */
export const CUSTOM_THEME_STYLE_ID = 'mizuki-custom-theme-style';

/** 存量上限：条目 20 个、单条 CSS 200KB（防 localStorage 配额爆掉） */
export const MAX_CUSTOM_THEMES = 20;
export const MAX_CSS_LENGTH = 200_000;

/** 预设主题（樱花粉 = 内置默认，不在预设卡中重复出现，走「恢复默认」） */
export const PRESET_THEMES: PresetTheme[] = [
  {
    id: 'preset-mint',
    name: '薄荷青',
    primary: '#3eb489',
    darkPrimary: '#5fc7a2',
    description: '清爽的青绿色系，适合浅色调工作台',
  },
  {
    id: 'preset-sky',
    name: '天空蓝',
    primary: '#4d9de0',
    darkPrimary: '#6db3ea',
    description: '冷静的蓝色系，经典管理面板配色',
  },
  {
    id: 'preset-twilight',
    name: '暮光紫',
    primary: '#9d6fe0',
    darkPrimary: '#b48ae8',
    description: '柔和的紫色系，暗色模式下尤为出色',
  },
  {
    id: 'preset-sunset',
    name: '落日橙',
    primary: '#e08a4d',
    darkPrimary: '#eda268',
    description: '温暖的橙色系，高辨识度强调色',
  },
];

// ── 颜色工具（与 element 官方混色算法对齐，无第三方依赖） ──

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** 解析 #rgb / #rrggbb；非法输入返回 null（预设值受控，仅防御） */
function parseHex(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (m === null) return null;
  const body = m[1] ?? '';
  const full =
    body.length === 3
      ? body
          .split('')
          .map((c) => c + c)
          .join('')
      : body;
  const int = Number.parseInt(full, 16);
  if (Number.isNaN(int)) return null;
  return { r: (int >> 16) & 0xff, g: (int >> 8) & 0xff, b: int & 0xff };
}

/** 线性插值混色：t = b 的占比（0..1） */
function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (ca === null || cb === null) return a;
  const clamped = Math.min(1, Math.max(0, t));
  const ch = (x: number, y: number): number => Math.round(x * (1 - clamped) + y * clamped);
  return `#${[ch(ca.r, cb.r), ch(ca.g, cb.g), ch(ca.b, cb.b)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

function rgba(hex: string, alpha: number): string {
  const c = parseHex(hex) ?? { r: 0, g: 0, b: 0 };
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

/**
 * 生成一套主色阶变量（对齐 element/theme-chalk 混色算法 + theme.css 结构）：
 * light-N = 主色 ×(10-N)/10 + 白 ×N/10；dark 态向 #141414 混合；
 * dark-2 = 主色 80% + 黑 20%（亮）/ 保持高亮主色（暗，与 theme.css 口径一致）。
 */
function shadeVars(primary: string, dark: boolean): string {
  const base = dark ? '#141414' : '#ffffff';
  const light = (n: number): string => mix(primary, base, n / 10);
  const dark2 = dark ? mix(primary, '#ffffff', 0.15) : mix(primary, '#000000', 0.2);
  const shadowAlpha = dark ? 0.08 : 0.1;
  const pageBg = dark
    ? `linear-gradient(165deg, ${mix(primary, '#0a0a0a', 0.92)} 0%, #0a0a0a 55%)`
    : `linear-gradient(165deg, ${mix(primary, '#ffffff', 0.9)} 0%, #f5f7fa 55%)`;
  return [
    `  --mizuki-primary: ${primary};`,
    `  --el-color-primary: var(--mizuki-primary);`,
    `  --el-color-primary-light-3: ${light(3)};`,
    `  --el-color-primary-light-5: ${light(5)};`,
    `  --el-color-primary-light-7: ${light(7)};`,
    `  --el-color-primary-light-8: ${light(8)};`,
    `  --el-color-primary-light-9: ${light(9)};`,
    `  --el-color-primary-dark-2: ${dark2};`,
    `  --mizuki-page-bg: ${pageBg};`,
    `  --mizuki-card-shadow: 0 4px 18px ${rgba(primary, shadowAlpha)};`,
  ].join('\n');
}

/** 预设主题 → 完整 CSS（:root 亮 + html.dark 暗） */
export function generatePresetCss(preset: PresetTheme): string {
  return `:root {\n${shadeVars(preset.primary, false)}\n}\n\nhtml.dark {\n${shadeVars(preset.darkPrimary, true)}\n}\n`;
}

// ── localStorage 读写 ──

/** 条目级运行时校验（手写防御；非法条目静默丢弃，fail-safe） */
function sanitizeItems(raw: unknown): CustomThemeItem[] {
  if (!Array.isArray(raw)) return [];
  const items: CustomThemeItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e['id'] === 'string' && e['id'] !== '' ? e['id'] : null;
    const name = typeof e['name'] === 'string' && e['name'].trim() !== '' ? e['name'] : null;
    const css = typeof e['css'] === 'string' ? e['css'] : null;
    if (id === null || name === null || css === null) continue;
    items.push({
      id,
      name: name.slice(0, 50),
      css: css.slice(0, MAX_CSS_LENGTH),
      updatedAt: typeof e['updatedAt'] === 'number' ? e['updatedAt'] : 0,
    });
  }
  return items.slice(0, MAX_CUSTOM_THEMES);
}

function readItems(): CustomThemeItem[] {
  try {
    const raw = localStorage.getItem(ITEMS_KEY);
    if (raw === null) return [];
    return sanitizeItems(JSON.parse(raw));
  } catch {
    return [];
  }
}

function writeItems(items: CustomThemeItem[]): void {
  localStorage.setItem(ITEMS_KEY, JSON.stringify(items));
}

// ── 对外 API ──

/** 列出全部用户自定义主题 */
export function listCustomThemes(): CustomThemeItem[] {
  return readItems();
}

/** 当前激活主题 id（null = 内置默认樱花粉；预设与自定义共用 id 空间） */
export function getActiveThemeId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

/**
 * 校验并保存（新增或按 id 更新）自定义主题；返回保存后的条目。
 * 抛 Error（中文文案，页面层直接展示）。
 */
export function saveCustomTheme(input: { id?: string; name: string; css: string }): CustomThemeItem {
  const name = input.name.trim();
  if (name === '') throw new Error('主题名称不能为空');
  if (name.length > 50) throw new Error('主题名称不能超过 50 个字符');
  const css = input.css;
  if (css.trim() === '') throw new Error('CSS 内容不能为空');
  if (css.length > MAX_CSS_LENGTH) throw new Error(`CSS 内容超过上限（${MAX_CSS_LENGTH} 字符）`);

  const items = readItems();
  const existing = input.id !== undefined ? items.find((i) => i.id === input.id) : undefined;
  const item: CustomThemeItem = {
    id: existing?.id ?? crypto.randomUUID(),
    name,
    css,
    updatedAt: Date.now(),
  };
  if (existing !== undefined) {
    const index = items.indexOf(existing);
    if (index >= 0) items[index] = item;
  } else {
    if (items.length >= MAX_CUSTOM_THEMES) {
      throw new Error(`自定义主题数量已达上限（${MAX_CUSTOM_THEMES} 个），请先删除部分主题`);
    }
    items.push(item);
  }
  writeItems(items);
  return item;
}

/** 删除自定义主题；若删除的是激活主题则同时清除激活态 */
export function deleteCustomTheme(id: string): void {
  const items = readItems().filter((i) => i.id !== id);
  writeItems(items);
  if (getActiveThemeId() === id) {
    setActiveTheme(null);
  }
}

/**
 * 设置激活主题并立即生效。
 * - id ∈ PRESET_THEMES：激活预设；
 * - id ∈ 自定义列表：激活自定义；
 * - null：恢复内置默认（移除注入节点 + 清键）。
 * 抛 Error（自定义 id 不存在）。
 */
export function setActiveTheme(id: string | null): void {
  if (id === null) {
    injectCss(null);
    try {
      localStorage.removeItem(ACTIVE_KEY);
    } catch {
      /* 存储不可用时仍保证本次会话生效 */
    }
    return;
  }
  const css = resolveCss(id);
  if (css === null) throw new Error('主题不存在或已被删除');
  injectCss(css);
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch (e) {
    throw new Error(`主题已生效但持久化失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 按 id 解析 CSS 文本（预设 → 生成；自定义 → 原文；未命中 → null） */
function resolveCss(id: string): string | null {
  const preset = PRESET_THEMES.find((p) => p.id === id);
  if (preset !== undefined) return generatePresetCss(preset);
  const custom = readItems().find((i) => i.id === id);
  return custom?.css ?? null;
}

/** 注入/移除自定义样式节点（重复调用覆盖同节点，幂等） */
function injectCss(css: string | null): void {
  let el = document.getElementById(CUSTOM_THEME_STYLE_ID);
  if (css === null) {
    el?.remove();
    return;
  }
  if (el === null) {
    el = document.createElement('style');
    el.id = CUSTOM_THEME_STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

/** 应用启动时接管（index.html 内联脚本已先行注入过同 id 节点） */
export function initCustomTheme(): void {
  const id = getActiveThemeId();
  if (id === null) return;
  const css = resolveCss(id);
  if (css !== null) injectCss(css);
}
