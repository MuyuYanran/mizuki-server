// [P9 测试夹具] 长驻任务（同 dev，供 preview 白名单用例）
console.log('mini preview ready');
const timer = setInterval(() => {
  console.log(`preview tick ${Date.now()}`);
}, 200);
process.on('SIGTERM', () => {
  clearInterval(timer);
  process.exit(0);
});
