import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * [P10a] Vite 配置
 * - dev 端口 20155（避免与后端 20154 冲突）；
 * - dev 代理：/api → http://localhost:20154（后端全局前缀 /api/v1，§2 授权的纯前端配置）；
 * - 生产同源：面板与后端同域部署，统一走 /api/v1（MASTER-PLAN §1）。
 *
 * [P10b] resolve.alias：@mizuki/shared 指向 packages/shared/src/index.ts。
 * shared 的 tsc 产物是 CJS（__exportStar 动态 re-export），vite 生产 build 的
 * rollup 无法静态分析跨模块 __exportStar，运行时找不到六类 schema 值导出。
 * 改由 src（ESM ts）直接消费：rollup 原生解析 export *，schema 对象可达；
 * server 仍走 dist/index.js（CJS）不受影响。optimizeDeps 仅留 zod
 * （shared 已走 src，不再预打包它本身）。
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@mizuki/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  optimizeDeps: {
    include: ['zod'],
  },
  server: {
    port: 20155,
    proxy: {
      '/api': {
        target: 'http://localhost:20154',
      },
    },
  },
});
