// timeline 数据文件：无插值模板字符串覆盖点
// [Phase3-C2b/ADR-018] 数据值迁移：id number→string（type 枚举本就合法）
import type { TimelineItem } from '../types';

export const timelineData: TimelineItem[] = [
  {
    id: '1',
    title: '大学毕业',
    description: `计算机科学与技术专业毕业，
获得工学学士学位。`,
    type: 'education',
    icon: 'material-symbols:school',
    color: '#059669',
    startDate: '2024-06-30',
    location: '济南',
    organization: '某某大学',
    skills: ['C++', '数据结构'],
    featured: true,
  },
  {
    id: '2',
    title: 'Mizuki 开源',
    description: '博客主题正式发布。',
    type: 'project',
    startDate: '2025-10-01',
    skills: ['Astro', 'TypeScript'],
  },
];

export const timelineCount = timelineData.length;
