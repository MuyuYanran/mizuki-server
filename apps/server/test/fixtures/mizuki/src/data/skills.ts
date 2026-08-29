// skills 数据文件：嵌套对象覆盖点
// [Phase3-C2b/ADR-018] 数据值迁移：id number→string、level number→官方枚举、
// category/icon/description/experience 必填面补齐（原前缀负号覆盖点 level:-3
// 随值域迁移移除，见 SESSIONS C2b fixture 变更清单）
import type { Skill } from '../types';

export const skillsData: Skill[] = [
  {
    id: '1',
    name: 'TypeScript',
    description: '类型体操爱好者',
    icon: 'logos:typescript-icon',
    category: 'frontend',
    level: 'expert',
    experience: { years: 4, months: 6 },
    color: '#3178c6',
  },
  {
    id: '2',
    name: 'Node.js',
    description: '服务端运行时',
    icon: 'logos:nodejs-icon',
    category: 'backend',
    level: 'advanced',
    experience: { years: 5, months: 0 },
  },
  // 第三条：历史遗留字段（LegacyScore），随官方字段面迁移补齐必填值
  {
    id: '3',
    name: 'LegacyScore',
    description: '历史遗留条目',
    icon: 'mdi:legacy',
    category: 'other',
    level: 'beginner',
    experience: { years: 1, months: 0 },
  },
];

export const skillsCount = skillsData.length;
