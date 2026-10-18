/**
 * [UI-U2 / K3] 浮动卡片 z-index 模块级管理器（起始 100，点击卡片递增置顶）
 */
let currentZ = 100;

export function bringToFront(): number {
  currentZ += 1;
  return currentZ;
}

export function getCurrentZ(): number {
  return currentZ;
}
