import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { isLoggedIn } from '../stores/auth';

/**
 * [P10a] 路由表与守卫
 * - 白名单：/login、/init（meta.public）；其余无 accessToken 一律回 /login；
 * - 已登录访问 /login 重定向主页；
 * - 主布局子路由除仪表盘外均为占位（P10b/c/d 逐阶段替换组件）。
 *
 * [P10b] 六类集合管理页接入：/collections/:type 单路由 + 动态组件实例，
 *   CollectionListPage 按 :type 复用；六类占位路由（diary/friends/...）
 *   由 /collections/:type 取代（菜单同步指向新路由）。
 *
 * [P10c] 文章模块接入：Markdown 文章列表/编辑/关于页 + 富文本列表/编辑。
 */
import MainLayout from '../layouts/MainLayout.vue';
import LoginView from '../views/LoginView.vue';
import InitWizardView from '../views/InitWizardView.vue';
import DashboardPlaceholder from '../views/DashboardPlaceholder.vue';
import PlaceholderView from '../views/PlaceholderView.vue';
import CollectionListPage from '../views/collections/CollectionListPage.vue';
import PostListPage from '../views/posts/PostListPage.vue';
import PostEditPage from '../views/posts/PostEditPage.vue';
import AboutEditPage from '../views/posts/AboutEditPage.vue';
import RichArticleListPage from '../views/articles/RichArticleListPage.vue';
import RichArticleEditPage from '../views/articles/RichArticleEditPage.vue';

/** 侧边栏菜单对应的占位子路由（标题经 meta 传递） */
const placeholderRoutes: RouteRecordRaw[] = [
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
      { path: 'collections/:type', component: CollectionListPage, meta: { title: '集合管理' } },
      // Markdown 文章
      { path: 'posts', component: PostListPage, meta: { title: 'Markdown 文章' } },
      { path: 'posts/new', component: PostEditPage, meta: { title: '新建文章' } },
      { path: 'posts/:slug/edit', component: PostEditPage, meta: { title: '编辑文章' } },
      // about 页
      { path: 'about', component: AboutEditPage, meta: { title: '关于页' } },
      // 富文本文章
      { path: 'articles', component: RichArticleListPage, meta: { title: '富文本文章' } },
      { path: 'articles/new', component: RichArticleEditPage, meta: { title: '新建富文本' } },
      { path: 'articles/:id/edit', component: RichArticleEditPage, meta: { title: '编辑富文本' } },
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
