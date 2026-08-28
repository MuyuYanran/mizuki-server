// skills 数据文件：嵌套对象与前缀负号覆盖点
import type { Skill } from '../types';

export const skillsData: Skill[] = [
  {
    id: 1,
    name: 'TypeScript',
    description: '类型体操爱好者',
    icon: 'si-typescript',
    category: '语言',
    level: 9,
    experience: { years: 4, months: 6 },
    color: '#3178c6',
  },
  {
    id: 2,
    name: 'Node.js',
    category: '运行时',
    level: 8,
    experience: { years: 5, months: 0 },
  },
  // 第三条：包含前缀负号（历史遗留字段，校验用）
  {
    id: 3,
    name: 'LegacyScore',
    level: -3,
  },
];

export const skillsCount = skillsData.length;
