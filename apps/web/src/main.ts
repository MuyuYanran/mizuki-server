import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
// Element Plus 官方 dark 模式变量（html.dark 全套生效，R2-1）
import 'element-plus/theme-chalk/dark/css-vars.css';
// Mizuki 主题（必须在 element 两个 css 之后，覆盖主色阶与调色板变量）
import './styles/theme.css';
import App from './App.vue';
import { router } from './router';
import { onSessionExpired } from './api/http';
import { initTheme } from './lib/theme';

/**
 * [P10a] 应用入口：Element Plus 完整引入（取舍记报告）+ 路由 +
 * 会话失效回调（401 refresh 失败 → 回登录页）。
 * [Phase2-B1] 接入主题系统：element dark 变量 + theme.css（顺序敏感）+
 * initTheme 接管 index.html 内联脚本的初始 dark 类（R2-1）。
 */

// 主题在 mount 前应用（避免首帧主题闪变）
initTheme();

const app = createApp(App);

app.use(ElementPlus);
app.use(router);

onSessionExpired(() => {
  void router.push('/login');
});

app.mount('#app');
