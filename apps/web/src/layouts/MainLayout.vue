<script setup lang="ts">
/**
 * [UI-U3] 主布局 · Nebula Shell（面板布局重构）
 *
 * [结构]（参照 NapCat WebUI 的**布局骨架**，视觉与内容全部保留 Mizuki 自身特色）
 *   ┌────────────┬──────────────────────────────────────────┐
 *   │  品牌区     │  浮动顶栏：折叠钮 + 页面标题 + 右侧动作      │
 *   │  导航分组   ├──────────────────────────────────────────┤
 *   │  （胶囊项） │                                          │
 *   │  底部动作区 │  内容浮岛（圆角卡，滚轮独立）              │
 *   │  主题/登出  │                                          │
 *   └────────────┴──────────────────────────────────────────┘
 *
 * [与旧版的差异]
 *  - 侧栏由「贴边面板 + 右侧描边」改为**悬浮胶囊列**（无边框、无直线）；
 *  - 顶栏由「通栏贴边横条」改为**悬浮玻璃胶囊**（左右留白、圆角、发丝渐隐）；
 *  - 页面标题由各页内标题**上提到顶栏**（页面内只留操作行，避免双标题）；
 *  - 主题切换 / 登出下沉到侧栏底部动作区（与参考站同位）；
 *  - 背景改多层柔和径向光晕（无硬边、无直线）。
 *
 * [保留的 Mizuki 特色]
 *  - 零依赖内联 SVG 图标（MenuIcon）、五大分组、最小模式（manage）菜单收窄、
 *    主题三态循环、AI 助手浮岛、浮岛仪表盘自由画布。
 *
 * [纪律] 行为零改动：路由、鉴权、模式过滤、登出语义与改版前逐字一致。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { authApi } from '../api/auth';
import { authState, clearAuth } from '../stores/auth';
import { ensureSystemMode, isMinimalMode, resetSystemMode, systemMode } from '../stores/system';
import { THEME_LABELS, cycleTheme, themePreference } from '../lib/theme';
import MenuIcon from '../components/MenuIcon.vue';
// [U4-AI2] 全局右侧 AI 聊天栏（开合状态在 stores/ai，这里只做挂载与顶栏开关）
import AiChatDrawer from '../components/AiChatDrawer.vue';
import { aiDrawerOpen, toggleDrawer } from '../stores/ai';

const route = useRoute();
const router = useRouter();

interface MenuItem {
  path: string;
  title: string;
  /** minimal（仅管理）模式下隐藏（[B2/裁决 7] 收窄后仅富文本文章） */
  minimalHidden?: boolean;
  /** [Phase4-D3] 菜单分组（#9 归类；undefined = 组外直显，如仪表盘） */
  group?: string;
  /** 仅精确路径命中才算激活（避免 '/settings' 抢 '/settings/ai' 的激活态） */
  exact?: boolean;
}

/** 侧边栏菜单（§3.6 清单逐字；P10c 拆分文章为 Markdown / 富文本两项；
 * [B2/裁决 7] 六类集合在 manage 模式下保留，仅富文本文章隐藏） */
const MENU: MenuItem[] = [
  { path: '/', title: '仪表盘' },
  { path: '/posts', title: 'Markdown 文章', group: '内容' },
  { path: '/articles', title: '富文本文章', minimalHidden: true, group: '内容' },
  { path: '/about', title: '关于页', group: '内容' },
  { path: '/collections/diary', title: '日记', group: '集合' },
  { path: '/collections/friends', title: '友链', group: '集合' },
  { path: '/collections/projects', title: '项目', group: '集合' },
  { path: '/collections/timeline', title: '时间线', group: '集合' },
  { path: '/collections/skills', title: '技能', group: '集合' },
  { path: '/collections/devices', title: '设备', group: '集合' },
  { path: '/collections/anime', title: '番剧', group: '集合' },
  { path: '/albums', title: '相册', group: '媒体' },
  { path: '/media', title: '媒体库', group: '媒体' },
  { path: '/backups', title: '备份', group: '运维' },
  { path: '/console', title: '构建预览', group: '运维' },
  { path: '/settings', title: '设置', group: '配置', exact: true },
  // [Phase3-C7] 站点配置受控子集（ADR-020）
  { path: '/site-config', title: '站点配置', group: '配置' },
  // [主题外观] 面板主题管理（预设 + 自定义 CSS，纯前端自包含）
  { path: '/theme', title: '主题外观', group: '配置' },
  // [U3-P4b/K4] 主题漂移呈现面板（漂移诊断在 manage 模式同样需要 → **不加** minimalHidden）
  { path: '/theme-status', title: '主题状态', group: '配置' },
  // [U4-AI2] AI 服务设置（provider 档案 / 代理 / 生成参数 / 连通性）
  { path: '/settings/ai', title: 'AI 服务', group: '配置' },
];

/** [Phase4-D3] 分组渲染顺序（固定；组内顺序随 MENU 声明序） */
const MENU_GROUPS = ['内容', '集合', '媒体', '运维', '配置'] as const;

/** 可见菜单：mode 未知（fail-open）时全量显示（R2-5） */
const visibleMenu = computed<MenuItem[]>(() =>
  isMinimalMode() ? MENU.filter((item) => !item.minimalHidden) : MENU,
);

/** [Phase4-D3] 组内可见项；过滤后组空 → 组壳隐藏（模板 v-if，manage 收窄边界） */
function menuByGroup(group: string): MenuItem[] {
  return visibleMenu.value.filter((item) => item.group === group);
}

/** 组外直显项（仪表盘） */
const topItems = computed<MenuItem[]>(() => visibleMenu.value.filter((item) => item.group === undefined));

/** minimal 模式下需要重定向到仪表盘的路由前缀（[B2/裁决 7] 仅富文本文章） */
const MINIMAL_HIDDEN_PREFIXES = ['/articles'];

const username = computed(() => authState.user?.username ?? '管理员');

/** 激活判定：exact 项只认精确路径；其余按「路径本身或其子路径」命中 */
function isActive(item: MenuItem): boolean {
  if (item.path === '/') return route.path === '/';
  if (item.exact === true) return route.path === item.path;
  return route.path === item.path || route.path.startsWith(`${item.path}/`);
}

/** 集合页标题（按路由参数取七类集合的中文名，与后端 registry 逐字对齐） */
const COLLECTION_TITLES: Record<string, string> = {
  diary: '日记',
  friends: '友链',
  projects: '项目',
  timeline: '时间线',
  skills: '技能',
  devices: '设备',
  anime: '番剧',
};

/** 顶栏页面标题：路由 meta 优先；集合页按类型取名 */
const pageTitle = computed<string>(() => {
  if (route.path.startsWith('/collections/')) {
    const type = route.params['type'];
    if (typeof type === 'string' && COLLECTION_TITLES[type] !== undefined) {
      return COLLECTION_TITLES[type];
    }
  }
  const metaTitle = route.meta['title'];
  return typeof metaTitle === 'string' && metaTitle !== '' ? metaTitle : 'Mizuki';
});

/** 顶栏副标题（一句话说明当前页面在做什么；缺省不显示） */
const PAGE_SUBTITLES: Record<string, string> = {
  '/': '工作台自由画布 · 随意拖拽卡片与调整尺寸',
  '/posts': '管理博客文章、草稿与回收站',
  '/articles': '富文本文章：所见即所得的排版编辑',
  '/about': '关于页：站点自我介绍与联系方式',
  '/albums': '公开与精选合集',
  '/media': '上传、引用与清理站点图片',
  '/backups': '创建快照与回滚历史版本',
  '/console': '执行构建任务与查看实时日志输出',
  '/settings': '运行态参数与账户安全管理',
  '/site-config': '受控子集：语言、评论、导航与站点信息',
  '/theme': '面板预设主题与自定义 CSS',
  '/theme-status': '主题漂移诊断与基线捕获',
  '/settings/ai': '服务档案 · 代理 · 生成参数 · 连通性',
};

const pageSubtitle = computed<string>(() => {
  if (route.path.startsWith('/collections/')) return '集合条目：增删改查与字段校验';
  if (route.path === '/posts/new') return '新建一篇 Markdown 文章';
  if (route.path.endsWith('/edit')) return '编辑模式：改动会写回站点文件';
  return PAGE_SUBTITLES[route.path] ?? '';
});

/** [U1] 响应式折叠状态：<1280px 自动折叠成图标侧栏，支持手动切换 */
const isCollapse = ref(false);
/** [U1-fix] 本次折叠是否由窄视口自动触发：回宽时只自动恢复「自动折叠」，不覆盖用户手动意图 */
const autoCollapsed = ref(false);

function handleResize(): void {
  if (typeof window === 'undefined') return;
  if (window.innerWidth < 1280) {
    if (!isCollapse.value) {
      isCollapse.value = true;
      autoCollapsed.value = true;
    }
  } else if (autoCollapsed.value) {
    isCollapse.value = false;
    autoCollapsed.value = false;
  }
}

function toggleCollapse(): void {
  isCollapse.value = !isCollapse.value;
  autoCollapsed.value = false;
}

onMounted(() => {
  // 登录后拉取系统状态读取 mode（R2-5 判定源；失败 fail-open 不阻塞）
  void ensureSystemMode();
  handleResize();
  window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
});

// 模式加载完成/变化时，若当前正处于被隐藏路由 → 重定向仪表盘
watch(systemMode, () => {
  if (isMinimalMode() && MINIMAL_HIDDEN_PREFIXES.some((p) => route.path.startsWith(p))) {
    void router.replace('/');
  }
});

async function logout(): Promise<void> {
  try {
    await authApi.logout();
  } catch {
    // 登出接口失败也继续清理本地态（无状态登出语义）
  }
  clearAuth();
  resetSystemMode();
  ElMessage.success('已登出');
  void router.push('/login');
}

function go(path: string): void {
  if (route.path === path) return;
  void router.push(path);
}
</script>

<template>
  <div class="shell" :class="{ 'is-collapsed': isCollapse }">
    <!-- ── 左导航栏（悬浮胶囊列） ── -->
    <aside class="rail">
      <div class="rail-brand">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
            <path d="M12 22.5A6.5 6.5 0 0 0 12 9.5" />
          </svg>
        </span>
        <span class="brand-text">
          <span class="brand-name">Mizuki</span>
          <span class="brand-sub">管理面板</span>
        </span>
      </div>

      <nav class="rail-nav">
        <!-- 组外直显（仪表盘） -->
        <div class="nav-block">
          <button
            v-for="item in topItems"
            :key="item.path"
            type="button"
            class="nav-item"
            :class="{ 'is-active': isActive(item) }"
            :title="isCollapse ? item.title : undefined"
            @click="go(item.path)"
          >
            <MenuIcon :path="item.path" />
            <span class="nav-item-text">{{ item.title }}</span>
            <span class="nav-item-mark" aria-hidden="true"></span>
          </button>
        </div>

        <!-- 分组导航 -->
        <div v-for="group in MENU_GROUPS" :key="group" class="nav-block">
          <div v-if="menuByGroup(group).length > 0" class="nav-group">
            <span class="nav-group-label">{{ group }}</span>
            <button
              v-for="item in menuByGroup(group)"
              :key="item.path"
              type="button"
              class="nav-item"
              :class="{ 'is-active': isActive(item) }"
              :title="isCollapse ? item.title : undefined"
              @click="go(item.path)"
            >
              <MenuIcon :path="item.path" />
              <span class="nav-item-text">{{ item.title }}</span>
              <span class="nav-item-mark" aria-hidden="true"></span>
            </button>
          </div>
        </div>
      </nav>

      <!-- 底部动作区（主题三态 / 登出） -->
      <div class="rail-foot">
        <button
          type="button"
          class="rail-action"
          :title="`主题：${THEME_LABELS[themePreference]}（点击切换）`"
          @click="cycleTheme"
        >
          <span class="rail-action-icon" aria-hidden="true">
            <svg v-if="themePreference === 'light'" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <circle cx="12" cy="12" r="4.5" />
              <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
            </svg>
            <svg v-else-if="themePreference === 'dark'" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11Z" />
            </svg>
            <svg v-else viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="13" rx="2" />
              <path d="M8.5 21h7M12 17.5V21" />
            </svg>
          </span>
          <span class="rail-action-text">{{ THEME_LABELS[themePreference] }}</span>
        </button>
        <button type="button" class="rail-action is-danger" title="退出登录" @click="logout">
          <span class="rail-action-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </span>
          <span class="rail-action-text">退出登录</span>
        </button>
      </div>
    </aside>

    <!-- ── 舞台：浮动顶栏 + 内容浮岛 ── -->
    <div class="stage">
      <header class="topbar">
        <button
          type="button"
          class="hamburger"
          :title="isCollapse ? '展开导航' : '收起导航'"
          aria-label="切换侧栏折叠"
          @click="toggleCollapse"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div class="topbar-heading">
          <h1 class="topbar-title">{{ pageTitle }}</h1>
          <span v-if="pageSubtitle" class="topbar-subtitle">{{ pageSubtitle }}</span>
        </div>
        <div class="topbar-right">
          <button
            type="button"
            class="topbar-chip"
            :class="{ 'is-on': aiDrawerOpen }"
            :title="aiDrawerOpen ? '收起 AI 助手' : '打开 AI 助手'"
            @click="toggleDrawer"
          >
            <span class="topbar-chip-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3.5l1.9 4.4 4.6 1.7-4.6 1.7L12 15.7l-1.9-4.4L5.5 9.6l4.6-1.7Z" />
                <path d="M18.5 15.5l.8 1.9 2 .7-2 .7-.8 1.9-.8-1.9-2-.7 2-.7Z" />
              </svg>
            </span>
            <span>AI 助手</span>
          </button>
          <span class="topbar-user" :title="username">
            <span class="topbar-user-dot" aria-hidden="true"></span>
            <span class="topbar-user-name">{{ username }}</span>
          </span>
        </div>
      </header>

      <main class="stage-main">
        <router-view />
      </main>
    </div>

    <!-- [U4-AI2] 全局 AI 助手（浮岛式，fixed 定位；放在布局外避免受布局盒影响） -->
    <AiChatDrawer />
  </div>
</template>

<style scoped>
/* ══════════════════════════════════════════════════════════════
   外壳：背景为多层柔和光晕（无硬边、无直线）
   ══════════════════════════════════════════════════════════════ */
.shell {
  display: flex;
  min-height: 100vh;
  background: var(--mizuki-shell-bg);
  background-attachment: fixed;
  color: var(--el-text-color-primary);
}

/* ── 左导航栏 ── */
.rail {
  position: sticky;
  top: 0;
  align-self: flex-start;
  height: 100vh;
  width: var(--mizuki-rail-width);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px 14px 18px;
  box-sizing: border-box;
  transition: width var(--mizuki-motion-base) cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

.shell.is-collapsed .rail {
  width: var(--mizuki-rail-width-collapsed);
  padding-left: 10px;
  padding-right: 10px;
}

/* 品牌区 */
.rail-brand {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 6px 8px 2px;
  min-width: 0;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border-radius: 14px;
  background: var(--mizuki-gradient-primary);
  color: #ffffff;
  box-shadow: 0 6px 18px color-mix(in srgb, var(--el-color-primary) 38%, transparent);
}

.brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  white-space: nowrap;
}

.brand-name {
  font-size: 17px;
  font-weight: 800;
  letter-spacing: -0.01em;
  line-height: 1.2;
  background: linear-gradient(120deg, var(--el-color-primary), var(--el-color-primary-dark-2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.brand-sub {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  letter-spacing: 0.14em;
}

.shell.is-collapsed .brand-text {
  display: none;
}

/* 导航区 */
.rail-nav {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-right: 2px;
  /* 侧栏滚动条隐去：滚动靠滚轮，视觉上不留硬直线 */
  scrollbar-width: none;
}

.rail-nav::-webkit-scrollbar {
  display: none;
}

.nav-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* 分组标签：小胶囊，折叠态隐藏（避免窄栏里出现竖排乱码） */
.nav-group-label {
  display: inline-block;
  align-self: flex-start;
  margin: 2px 0 4px 12px;
  padding: 2px 10px;
  border-radius: var(--mizuki-radius-pill);
  background: color-mix(in srgb, var(--el-fill-color-light) 70%, transparent);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: var(--el-text-color-placeholder);
  text-transform: uppercase;
  white-space: nowrap;
}

.shell.is-collapsed .nav-group-label {
  display: none;
}

.shell.is-collapsed .nav-group {
  gap: 6px;
  padding-top: 10px;
  background-image: var(--mizuki-fade-hairline);
  background-repeat: no-repeat;
  background-position: left top;
  background-size: 100% 1px;
}

.shell.is-collapsed .nav-group:first-child {
  padding-top: 0;
  background-image: none;
}

/* 导航项：胶囊 */
.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  padding: 9px 13px;
  border: none;
  border-radius: var(--mizuki-radius-item);
  background: transparent;
  color: var(--el-text-color-regular);
  font-size: 14px;
  font-weight: 500;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--mizuki-motion-fast) ease,
    color var(--mizuki-motion-fast) ease,
    transform var(--mizuki-motion-fast) var(--mizuki-motion-spring);
}

.nav-item:hover {
  background: var(--mizuki-soft-hover);
  color: var(--el-color-primary);
  transform: translateX(2px);
}

/* [UI-U3] 图标悬停放大：原规则挂在 `el-menu-item` 上，面板改自绘导航后永不命中
   （图标放大静默失效）⇒ 改挂到本外壳的 `.nav-item`。
   `:deep()` 方向＝子组件内部类名，故写在父组件里。 */
.nav-item:hover :deep(.menu-svg-icon) {
  transform: scale(1.1);
}

.nav-item.is-active {
  background: var(--mizuki-gradient-primary);
  color: #ffffff;
  font-weight: 600;
  box-shadow: 0 6px 18px color-mix(in srgb, var(--el-color-primary) 32%, transparent);
}

.nav-item.is-active:hover {
  background: var(--mizuki-gradient-primary-hover);
  color: #ffffff;
  transform: translateX(2px);
}

.nav-item-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 激活指示：右侧一枚小圆点（替代参考站的短横杠，保留圆角语言） */
.nav-item-mark {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0;
  flex-shrink: 0;
  transition: opacity var(--mizuki-motion-fast) ease;
}

.nav-item.is-active .nav-item-mark {
  opacity: 0.9;
}

/* 折叠态：只留图标，居中 */
.shell.is-collapsed .nav-item {
  justify-content: center;
  gap: 0;
  padding: 10px 0;
}

.shell.is-collapsed .nav-item-text,
.shell.is-collapsed .nav-item-mark {
  display: none;
}

.shell.is-collapsed .nav-item:hover {
  transform: none;
}

/* 底部动作区 */
.rail-foot {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
  background-image: var(--mizuki-fade-hairline);
  background-repeat: no-repeat;
  background-position: left top;
  background-size: 100% 1px;
}

.rail-action {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 13px;
  border: none;
  border-radius: var(--mizuki-radius-item);
  background: transparent;
  color: var(--el-text-color-regular);
  font-size: 13px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--mizuki-motion-fast) ease, color var(--mizuki-motion-fast) ease;
}

.rail-action:hover {
  background: var(--mizuki-soft-hover);
  color: var(--el-color-primary);
}

.rail-action.is-danger:hover {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}

.rail-action-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.rail-action-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.shell.is-collapsed .rail-action {
  justify-content: center;
  padding: 10px 0;
}

.shell.is-collapsed .rail-action-text {
  display: none;
}

/* ══════════════════════════════════════════════════════════════
   舞台
   ══════════════════════════════════════════════════════════════ */
.stage {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: var(--mizuki-stage-pad) var(--mizuki-stage-pad) 0 6px;
  box-sizing: border-box;
}

/* 浮动顶栏：玻璃胶囊 */
.topbar {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
  height: 66px;
  padding: 0 20px;
  border-radius: var(--mizuki-radius-shell);
  background: var(--mizuki-shell-glass);
  backdrop-filter: var(--mizuki-glass-blur);
  -webkit-backdrop-filter: var(--mizuki-glass-blur);
  border: 1px solid var(--mizuki-soft-card-border);
  box-shadow: var(--mizuki-card-shadow);
}

.hamburger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border: none;
  border-radius: 14px;
  background: transparent;
  color: var(--el-text-color-regular);
  cursor: pointer;
  transition: background-color var(--mizuki-motion-fast) ease, color var(--mizuki-motion-fast) ease;
}

.hamburger:hover {
  background: var(--mizuki-soft-hover);
  color: var(--el-color-primary);
}

.topbar-heading {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.topbar-title {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.25;
  color: var(--el-text-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.topbar-subtitle {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.topbar-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border: none;
  border-radius: var(--mizuki-radius-pill);
  background: color-mix(in srgb, var(--el-fill-color-light) 72%, transparent);
  color: var(--el-text-color-regular);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: background-color var(--mizuki-motion-fast) ease, color var(--mizuki-motion-fast) ease;
}

.topbar-chip:hover {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.topbar-chip.is-on {
  background: var(--mizuki-gradient-primary);
  color: #ffffff;
  box-shadow: 0 4px 14px color-mix(in srgb, var(--el-color-primary) 32%, transparent);
}

.topbar-chip-icon {
  display: inline-flex;
  align-items: center;
}

.topbar-user {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 160px;
  height: 34px;
  padding: 0 14px;
  border-radius: var(--mizuki-radius-pill);
  background: color-mix(in srgb, var(--el-fill-color-lighter) 66%, transparent);
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.topbar-user-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--el-color-success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--el-color-success) 20%, transparent);
  flex-shrink: 0;
}

.topbar-user-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 内容区：独立滚动 */
.stage-main {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--mizuki-stage-pad) 2px var(--mizuki-stage-pad) 8px;
  box-sizing: border-box;
}
</style>
