<script setup lang="ts">
/**
 * [P10a] 主布局：顶栏（项目名 + 管理员 + 登出）+ 侧边栏菜单 + 内容区。
 * 菜单项按 §3.6 清单全量列出；未实现页面指向占位路由。
 * [Phase2-B1] 顶栏主题切换（R2-1 三态循环）+ 运行模式驱动菜单过滤
 *   （R2-5：minimal=manage 时隐藏富文本文章与六类集合）。
 * [Phase2-B2/裁决 7] manage 模式收窄放宽：仅隐藏富文本文章，
 *   六类集合菜单保留（原 R2-5 的六类隐藏不再生效）。
 * [Phase4-U1] 面板 UI 全面重设计：大圆角浮岛侧栏 + 零依赖内联图标 + 顶栏毛玻璃 + 窄屏折叠。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { authApi } from '../api/auth';
import { authState, clearAuth } from '../stores/auth';
import { ensureSystemMode, isMinimalMode, resetSystemMode, systemMode } from '../stores/system';
import { THEME_LABELS, cycleTheme, themePreference } from '../lib/theme';
import MenuIcon from '../components/MenuIcon.vue';

const route = useRoute();
const router = useRouter();

interface MenuItem {
  path: string;
  title: string;
  /** minimal（仅管理）模式下隐藏（[B2/裁决 7] 收窄后仅富文本文章） */
  minimalHidden?: boolean;
  /** [Phase4-D3] 菜单分组（#9 归类；undefined = 组外直显，如仪表盘） */
  group?: string;
}

/** 侧边栏菜单（§3.6 清单逐字；P10c 拆分文章为 Markdown / 富文本两项；
 * [B2/裁决 7] 六类集合在 manage 模式下保留，仅富文本文章隐藏；
 * [Phase4-D3] group 归类：过滤键 minimalHidden 在分组重构后保持 item 级不变） */
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
  { path: '/settings', title: '设置', group: '配置' },
  // [Phase3-C7] 站点配置受控子集（ADR-020）
  { path: '/site-config', title: '站点配置', group: '配置' },
  // [主题外观] 面板主题管理（预设 + 自定义 CSS，纯前端自包含）
  { path: '/theme', title: '主题外观', group: '配置' },
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

/** minimal 模式下需要重定向到仪表盘的路由前缀（[B2/裁决 7] 仅富文本文章） */
const MINIMAL_HIDDEN_PREFIXES = ['/articles'];

const activeMenu = computed(() => route.path);
const username = computed(() => authState.user?.username ?? '管理员');

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
</script>

<template>
  <el-container class="layout-root">
    <el-header class="layout-header">
      <div class="brand-area">
        <button
          type="button"
          class="collapse-btn"
          :title="isCollapse ? '展开菜单' : '折叠菜单'"
          aria-label="切换侧栏折叠"
          @click="toggleCollapse"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span class="brand">Mizuki 管理面板</span>
      </div>
      <div class="user-area">
        <el-button
          size="small"
          class="theme-toggle"
          :title="`主题：${THEME_LABELS[themePreference]}（点击切换）`"
          @click="cycleTheme"
        >
          <span class="theme-icon" aria-hidden="true">
            <!-- 三态内联图标：太阳 / 月亮 / 显示器（零图标依赖） -->
            <svg v-if="themePreference === 'light'" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <circle cx="12" cy="12" r="4.5" />
              <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
            </svg>
            <svg v-else-if="themePreference === 'dark'" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11Z" />
            </svg>
            <svg v-else viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="13" rx="2" />
              <path d="M8.5 21h7M12 17.5V21" />
            </svg>
          </span>
          <span class="theme-label">{{ THEME_LABELS[themePreference] }}</span>
        </el-button>
        <span class="username">{{ username }}</span>
        <el-button size="small" @click="logout">登出</el-button>
      </div>
    </el-header>
    <el-container class="layout-body">
      <el-aside :width="isCollapse ? '72px' : '230px'" class="layout-aside">
        <el-menu
          :default-active="activeMenu"
          :collapse="isCollapse"
          :collapse-transition="false"
          router
          class="layout-menu"
        >
          <el-menu-item index="/">
            <MenuIcon path="/" />
            <template #title>
              <span>{{ MENU[0]?.title ?? '仪表盘' }}</span>
            </template>
          </el-menu-item>
          <!-- [Phase4-D3] 分组归类：组内全空（manage 收窄后）→ 组壳 v-if 隐藏 -->
          <template v-for="group in MENU_GROUPS" :key="group">
            <el-menu-item-group v-if="menuByGroup(group).length > 0">
              <template #title>
                <span class="group-title">{{ group }}</span>
              </template>
              <el-menu-item v-for="item in menuByGroup(group)" :key="item.path" :index="item.path">
                <MenuIcon :path="item.path" />
                <template #title>
                  <span>{{ item.title }}</span>
                </template>
              </el-menu-item>
            </el-menu-item-group>
          </template>
        </el-menu>
      </el-aside>
      <el-main class="layout-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.layout-root {
  min-height: 100vh;
  background: var(--mizuki-page-bg);
}
.layout-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 60px;
  padding: 0 20px;
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--mizuki-glass-bg);
  backdrop-filter: var(--mizuki-glass-blur);
  -webkit-backdrop-filter: var(--mizuki-glass-blur);
  border-bottom: 1px solid var(--mizuki-border-hairline);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.02);
}
.brand-area {
  display: flex;
  align-items: center;
  gap: 12px;
}
.collapse-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--mizuki-radius-control);
  background: transparent;
  border: 1px solid transparent;
  color: var(--el-text-color-regular);
  cursor: pointer;
  transition: all var(--mizuki-motion-fast) ease;
}
.collapse-btn:hover {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  border-color: var(--mizuki-border-hairline);
}
.brand {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
  /* 主色品牌字（走 --el-color-primary，R2-1 禁散落硬编码） */
  background: linear-gradient(120deg, var(--el-color-primary), var(--el-color-primary-dark-2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.user-area {
  display: flex;
  align-items: center;
  gap: 12px;
}
.username {
  color: var(--el-text-color-secondary);
  font-size: 14px;
}
.theme-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: var(--mizuki-radius-pill);
}
.theme-icon {
  display: inline-flex;
  align-items: center;
}
.theme-label {
  font-size: 12px;
}

.layout-body {
  height: calc(100vh - 60px);
}

/* [Phase4-U1] 浮岛式大圆角侧栏 */
.layout-aside {
  border-right: none;
  background: transparent;
  padding: 16px 8px 16px 16px;
  height: 100%;
  box-sizing: border-box;
  transition: width var(--mizuki-motion-base) cubic-bezier(0.4, 0, 0.2, 1);
}
.layout-menu {
  border-right: none;
  background: var(--mizuki-nav-panel-bg);
  border: 1px solid var(--mizuki-border-hairline);
  border-radius: var(--mizuki-radius-card);
  box-shadow: var(--mizuki-card-shadow);
  padding: 12px 6px;
  height: 100%;
  box-sizing: border-box;
  overflow-y: auto;
  overflow-x: hidden;
  transition: box-shadow var(--mizuki-motion-base), border-color var(--mizuki-motion-base);
}
.layout-menu:hover {
  box-shadow: var(--mizuki-lift-shadow);
}
.layout-menu:not(.el-menu--collapse) {
  width: 100%;
}
.layout-menu.el-menu--collapse {
  width: 100%;
  padding: 12px 4px;
}
.layout-menu :deep(.el-menu-item) {
  height: 42px;
  line-height: 42px;
  margin: 3px 0;
  border-radius: var(--mizuki-radius-control);
  color: var(--mizuki-nav-item-color);
  font-weight: 500;
  transition: background-color var(--mizuki-motion-fast) ease,
              color var(--mizuki-motion-fast) ease,
              transform var(--mizuki-motion-fast) var(--mizuki-motion-spring);
}
.layout-menu :deep(.el-menu-item:hover) {
  background: var(--mizuki-nav-item-bg-hover);
  color: var(--mizuki-nav-item-color-active);
  transform: translateX(2px);
}
.layout-menu.el-menu--collapse :deep(.el-menu-item:hover) {
  transform: none;
}
.layout-menu :deep(.el-menu-item.is-active) {
  background: var(--mizuki-nav-item-bg-active);
  color: var(--mizuki-nav-item-color-active);
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}
.layout-menu :deep(.el-menu-item-group__title) {
  color: var(--mizuki-nav-item-color);
  opacity: 0.55;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 12px 10px 4px;
}
.group-title {
  display: inline-block;
}
.layout-main {
  background: transparent;
  padding: 20px;
  overflow-y: auto;
  height: 100%;
  box-sizing: border-box;
}
</style>
