// [P9 测试夹具] 快速任务：输出 2500 行后自然退出（供环形缓冲验收）。
// 用 fs.writeSync 同步写 stdout：避免进程退出时异步管道截断（Windows 尤其明显）。
// 动态 import（夹具为 CJS 包，不用 require 以通过仓库 lint 规则）。
import('node:fs').then((fs) => {
  for (let i = 1; i <= 2500; i++) {
    fs.writeSync(1, `line-${String(i).padStart(4, '0')}\n`);
  }
});
