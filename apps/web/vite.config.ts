import fs from 'node:fs';
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
 *
 * [Phase2-B1 / R2-8] dev 形态的 Mizuki public/ 预览源：优先 MIZUKI_ROOT
 * 环境变量，其次读取本机 apps/server/data/config.json 的 mizukiRoot，将其
 * public 目录作为 vite publicDir（仅 dev——面板自身不托管 Mizuki 静态产物，
 * P11 遗留；生产 build 不设置，避免把站点产物拷进面板 dist）。相册/媒体
 * 缩略图 URL（/images/albums/…、/images/uploads/…）由此同源可预览；
 * 均不可用（全新克隆）时静默跳过。
 */
function resolveMizukiPublicDir(): string | undefined {
  try {
    let mizukiRoot = process.env['MIZUKI_ROOT'];
    if (!mizukiRoot) {
      const configPath = path.resolve(__dirname, '../server/data/config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { mizukiRoot?: string };
      mizukiRoot = config.mizukiRoot;
    }
    if (typeof mizukiRoot === 'string' && mizukiRoot !== '') {
      const publicDir = path.join(mizukiRoot, 'public');
      if (fs.existsSync(publicDir)) {
        return publicDir;
      }
    }
  } catch {
    // 配置不存在/不可解析 → 无预览源，保持默认行为
  }
  return undefined;
}

export default defineConfig(({ command }) => ({
  plugins: [vue()],
  resolve: {
    alias: {
      '@mizuki/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  optimizeDeps: {
    include: [
      'zod',
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/commands',
      '@codemirror/language',
      '@codemirror/lang-markdown',
      '@tiptap/vue-3',
      '@tiptap/starter-kit',
      '@tiptap/extension-link',
      '@tiptap/extension-image',
      '@tiptap/extension-table',
      '@tiptap/extension-table-row',
      '@tiptap/extension-table-header',
      '@tiptap/extension-table-cell',
      // [Phase2-B1] 新依赖预打包（cropper/viewer 为 UMD/CJS 混合产物）
      'vue-cropper',
      'v-viewer',
      'viewerjs',
    ],
  },
  server: {
    port: 20155,
    proxy: {
      '/api': {
        target: 'http://localhost:20154',
      },
    },
  },
  // 仅 dev 形态挂 Mizuki public/（build 不拷贝站点产物）
  publicDir: command === 'serve' ? resolveMizukiPublicDir() : undefined,
}));
