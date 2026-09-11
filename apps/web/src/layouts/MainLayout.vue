<script setup lang="ts">
/**
 * [P10a] 主布局：顶栏（项目名 + 管理员 + 登出）+ 侧边栏菜单 + 内容区。
 * 菜单项按 §3.6 清单全量列出；未实现页面指向占位路由。
 * [Phase2-B1] 顶栏主题切换（R2-1 三态循环）+ 运行模式驱动菜单过滤
 *   （R2-5：minimal=manage 时隐藏富文本文章与六类集合）。
 * [Phase2-B2/裁决 7] manage 模式收窄放宽：仅隐藏富文本文章，
 *   六类集合菜单保留（原 R2-5 的六类隐藏不再生效）。
 */
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { authApi } from '../api/auth';
import { authState, clearAuth } from '../stores/auth';
import { ensureSystemMode, isMinimalMode, resetSystemMode, systemMode } from '../stores/system';
import { THEME_LABELS, cycleTheme, themePreference } from '../lib/theme';

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

onMounted(() => {
  // 登录后拉取系统状态读取 mode（R2-5 判定源；失败 fail-open 不阻塞）
  void ensureSystemMode();
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
      <span class="brand">Mizuki 管理面板</span>
      <span class="user-area">
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
      </span>
    </el-header>
    <el-container>
      <el-aside width="220px" class="layout-aside">
        <el-menu :default-active="activeMenu" router class="layout-menu">
          <el-menu-item index="/">{{ MENU[0]?.title ?? '仪表盘' }}</el-menu-item>
          <!-- [Phase4-D3] 分组归类：组内全空（manage 收窄后）→ 组壳 v-if 隐藏 -->
          <template v-for="group in MENU_GROUPS" :key="group">
            <el-menu-item-group v-if="menuByGroup(group).length > 0">
              <template #title>{{ group }}</template>
              <el-menu-item v-for="item in menuByGroup(group)" :key="item.path" :index="item.path">
                {{ item.title }}
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
}
.layout-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--el-border-color);
}
.brand {
  font-size: 18px;
  font-weight: 700;
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
}
.theme-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.theme-icon {
  display: inline-flex;
  align-items: center;
}
.theme-label {
  font-size: 12px;
}
/* [Phase4-D4e/R2] 侧栏 Mizuki 化：卡片式容器 + 胶囊导航项 + MD3 hover/active 态。
   token 全走 --mizuki-nav-* 变量族（theme.css，明暗两套；主题实测提取见 R1 对照表）。
   MD3 比对裁定（冲突以主题实测为准）：卡片圆角 16px 与主题 --radius-large 同值采纳；
   「大面 24px」主题无对应（面板容器实测一律 --radius-large 1rem）→ 采纳主题；
   hover/active 状态层 = 主题 --btn-plain-bg-hover/-active 体系（main.css .dropdown-item
   同构翻译），非 MD3 纯 overlay 层。菜单数据/路由/manage 过滤零触碰（仅样式层）。 */
.layout-aside {
  border-right: none;
  background: transparent;
  padding: 12px 10px;
}
.layout-menu {
  border-right: none;
  background: var(--mizuki-nav-panel-bg);
  border: 1px solid var(--mizuki-nav-divider);
  border-radius: var(--mizuki-radius-card);
  box-shadow: var(--mizuki-card-shadow);
  padding: 8px 10px;
  overflow-y: auto;
}
.layout-menu :deep(.el-menu-item) {
  height: 40px;
  line-height: 40px;
  margin: 2px 0;
  border-radius: var(--mizuki-radius-control);
  color: var(--mizuki-nav-item-color);
  font-weight: 500;
  transition: background-color 150ms ease, color 150ms ease;
}
.layout-menu :deep(.el-menu-item:hover) {
  background: var(--mizuki-nav-item-bg-hover);
  color: var(--mizuki-nav-item-color-active);
}
.layout-menu :deep(.el-menu-item.is-active) {
  background: var(--mizuki-nav-item-bg-active);
  color: var(--mizuki-nav-item-color-active);
  font-weight: 600;
}
.layout-menu :deep(.el-menu-item-group__title) {
  color: var(--mizuki-nav-item-color);
  opacity: 0.65;
  font-size: 12px;
  padding: 10px 0 4px;
}
.layout-main {
  background: var(--mizuki-page-bg);
}
</style>
