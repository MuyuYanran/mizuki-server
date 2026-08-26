import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { isLoggedIn } from '../stores/auth';

/**
 * [P10a] 路由表与守卫
 * - 白名单：/login、/init（meta.public）；其余无 accessToken 一律回 /login；
 * - 已登录访问 /login 重定向主页；
 * - 主布局子路由除仪表盘外均为占位（P10b/c/d 逐阶段替换组件）。
 */
import MainLayout from '../layouts/MainLayout.vue';
import LoginView from '../views/LoginView.vue';
import InitWizardView from '../views/InitWizardView.vue';
import DashboardPlaceholder from '../views/DashboardPlaceholder.vue';
import PlaceholderView from '../views/PlaceholderView.vue';

/** 侧边栏菜单对应的占位子路由（标题经 meta 传递） */
const placeholderRoutes: RouteRecordRaw[] = [
  { path: 'articles', component: PlaceholderView, meta: { title: '文章' } },
  { path: 'diary', component: PlaceholderView, meta: { title: '日记' } },
  { path: 'friends', component: PlaceholderView, meta: { title: '友链' } },
  { path: 'projects', component: PlaceholderView, meta: { title: '项目' } },
  { path: 'timeline', component: PlaceholderView, meta: { title: '时间线' } },
  { path: 'skills', component: PlaceholderView, meta: { title: '技能' } },
  { path: 'devices', component: PlaceholderView, meta: { title: '设备' } },
  { path: 'albums', component: PlaceholderView, meta: { title: '相册' } },
  { path: 'media', component: PlaceholderView, meta: { title: '媒体库' } },
  { path: 'backups', component: PlaceholderView, meta: { title: '备份' } },
  { path: 'console', component: PlaceholderView, meta: { title: '构建预览' } },
  { path: 'settings', component: PlaceholderView, meta: { title: '设置' } },
];

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
  { path: '/init', name: 'init', component: InitWizardView, meta: { public: true } },
  {
    path: '/',
    component: MainLayout,
    children: [
      { path: '', component: DashboardPlaceholder, meta: { title: '仪表盘' } },
      ...placeholderRoutes,
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  const isPublic = to.meta.public === true;
  if (!isPublic && !isLoggedIn()) {
    return { path: '/login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} };
  }
  if (to.path === '/login' && isLoggedIn()) {
    return { path: '/' };
  }
  return true;
});
