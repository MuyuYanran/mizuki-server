/**
 * [Phase3-C4] vitest 全局 setup（先于测试文件求值执行）
 * [职责] 测试环境 preview 通道缺省端口 0（临时端口）：38 个 spec 并行
 *   worker 各自引导 AppModule 时不会抢占真实 4173 端口（EADDRINUSE）。
 *   各 spec 仍可在文件内显式覆盖（本文件只做缺省，不覆盖已有值）。
 */
process.env['MIZUKI_PREVIEW_PORT'] ??= '0';
