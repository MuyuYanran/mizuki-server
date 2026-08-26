import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 注意：规格 §4.1 的 e2e 测试文件直接使用全局 describe/it/expect，
    // 而同名配置未声明 globals，二者矛盾。此处开启 globals:true 让测试原样跑通（不改变行为）。
    globals: true,
    // 注意：除常规 *.spec.ts 外，显式纳入 *-spec.ts，以覆盖 app.e2e-spec.ts
    // （目录树已固定该文件名，故在此扩展 include 而非改动文件名）
    include: ['test/**/*.spec.ts', 'test/**/*-spec.ts'],
    environment: 'node',
    // 沙盒/慢机环境下 tsc --noEmit 子进程调用等集成测试可能逼近 5s 默认上限；
    // 30s 留足缓冲，避免非确定性超时（P3 golden 集成测试受此影响）。
    testTimeout: 30000,
  },
  plugins: [swc.vite()],
});
