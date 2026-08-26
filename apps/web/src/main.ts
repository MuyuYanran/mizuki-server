import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import App from './App.vue';
import { router } from './router';
import { onSessionExpired } from './api/http';

/**
 * [P10a] 应用入口：Element Plus 完整引入（取舍记报告）+ 路由 +
 * 会话失效回调（401 refresh 失败 → 回登录页）。
 */
const app = createApp(App);

app.use(ElementPlus);
app.use(router);

onSessionExpired(() => {
  void router.push('/login');
});

app.mount('#app');
