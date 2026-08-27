import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { isLoggedIn } from '../stores/auth';
import { ensureSystemMode, isMinimalMode } from '../stores/system';

/**
 * [P10a] 路由表与守卫
 * - 白名单：/login、/init（meta.public）；其余无 accessToken 一律回 /login；
 * - 已登录访问 /login 重定向主页。
 *
 * [P10b] 六类集合管理页接入：/collections/:type 单路由 + 动态组件实例。
 * [P10c] 文章模块接入：Markdown 文章列表/编辑/关于页 + 富文本列表/编辑。
 * [P10d] 面板剩余模块接入：媒体库/相册（列表+详情）/备份/控制台/仪表盘/设置，
 *   占位路由全部清空，菜单指向真实页面。
 */
import MainLayout from '../layouts/MainLayout.vue';
import LoginView from '../views/LoginView.vue';
import InitWizardView from '../views/InitWizardView.vue';
import DashboardPage from '../views/DashboardPage.vue';
import CollectionListPage from '../views/collections/CollectionListPage.vue';
import PostListPage from '../views/posts/PostListPage.vue';
import PostEditPage from '../views/posts/PostEditPage.vue';
import AboutEditPage from '../views/posts/AboutEditPage.vue';
import RichArticleListPage from '../views/articles/RichArticleListPage.vue';
import RichArticleEditPage from '../views/articles/RichArticleEditPage.vue';
import MediaLibraryPage from '../views/media/MediaLibraryPage.vue';
import AlbumsPage from '../views/albums/AlbumsPage.vue';
import AlbumDetailPage from '../views/albums/AlbumDetailPage.vue';
import BackupsPage from '../views/backups/BackupsPage.vue';
import ConsolePage from '../views/process/ConsolePage.vue';
import SettingsPage from '../views/settings/SettingsPage.vue';

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
  { path: '/init', name: 'init', component: InitWizardView, meta: { public: true } },
  {
    path: '/',
    component: MainLayout,
    children: [
      { path: '', component: DashboardPage, meta: { title: '仪表盘' } },
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
      // [P10d] 面板剩余模块
      { path: 'albums', component: AlbumsPage, meta: { title: '相册' } },
      { path: 'albums/:id', component: AlbumDetailPage, meta: { title: '相册详情' } },
      { path: 'media', component: MediaLibraryPage, meta: { title: '媒体库' } },
      { path: 'backups', component: BackupsPage, meta: { title: '备份' } },
      { path: 'console', component: ConsolePage, meta: { title: '构建预览' } },
      { path: 'settings', component: SettingsPage, meta: { title: '设置' } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

/**
 * minimal（仅管理）模式下重定向到仪表盘的路由前缀（R2-5：
 * 富文本文章 /articles* 与六类集合 /collections/*；直接敲路由不放行）
 */
const MINIMAL_HIDDEN_PREFIXES = ['/collections', '/articles'];

router.beforeEach(async (to) => {
  const isPublic = to.meta.public === true;
  if (!isPublic && !isLoggedIn()) {
    return { path: '/login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} };
  }
  if (to.path === '/login' && isLoggedIn()) {
    return { path: '/' };
  }
  // [Phase2-B1 / R2-5] 已登录且模式未加载 → 先补拉一次（刷新深链直达场景）。
  // 拉取失败 mode=null → fail-open 不拦（ensureSystemMode 内部静默）。
  if (!isPublic && isLoggedIn()) {
    await ensureSystemMode();
    if (isMinimalMode() && MINIMAL_HIDDEN_PREFIXES.some((p) => to.path.startsWith(p))) {
      return { path: '/' };
    }
  }
  return true;
});
