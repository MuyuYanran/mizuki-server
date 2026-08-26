// [P9 测试夹具] 长驻任务：打印 ready 后周期性心跳（供启停 + SSE 验收）
console.log('mini dev server ready');
const timer = setInterval(() => {
  console.log(`heartbeat ${Date.now()}`);
}, 200);
process.on('SIGTERM', () => {
  clearInterval(timer);
  process.exit(0);
});
