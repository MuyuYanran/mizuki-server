import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * [P10a] Vite 配置
 * - dev 端口 20155（避免与后端 20154 冲突）；
 * - dev 代理：/api → http://localhost:20154（后端全局前缀 /api/v1，§2 授权的纯前端配置）；
 * - 生产同源：面板与后端同域部署，统一走 /api/v1（MASTER-PLAN §1）。
 */
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 20155,
    proxy: {
      '/api': {
        target: 'http://localhost:20154',
      },
    },
  },
});
