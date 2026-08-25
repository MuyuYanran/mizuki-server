// devices 数据文件：grouped 对象结构覆盖点 `{分类: Device[]}`
import type { Device } from '../types';

export const devicesData: Record<string, Device[]> = {
  '电脑': [
    {
      name: 'MacBook Pro 14',
      image: 'mbp14.png',
      specs: 'M4 Pro / 24G / 1T',
      description: '主力开发机',
      link: 'https://www.apple.com',
    },
  ],
  '外设': [
    {
      name: 'HHKB Professional 2',
      specs: '静电容 白轴',
      description: '键盘',
    },
    {
      name: 'MX Master 3S',
      description: '鼠标',
    },
  ],
  // 空分组占位（写回时由上层负责清理空分组）
};

export const deviceGroupCount = Object.keys(devicesData).length;
