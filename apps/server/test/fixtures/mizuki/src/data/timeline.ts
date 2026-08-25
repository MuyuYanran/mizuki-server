// timeline 数据文件：无插值模板字符串覆盖点
import type { TimelineItem } from '../types';

export const timelineData: TimelineItem[] = [
  {
    id: 't-001',
    title: '大学毕业',
    description: `计算机科学与技术专业毕业，
获得工学学士学位。`,
    type: 'education',
    icon: 'graduation-cap',
    color: '#3b82f6',
    startDate: '2024-06-30',
    location: '济南',
    organization: '某某大学',
    skills: ['C++', '数据结构'],
    featured: true,
  },
  {
    id: 't-002',
    title: 'Mizuki 开源',
    description: '博客主题正式发布。',
    type: 'project',
    startDate: '2025-10-01',
    skills: ['Astro', 'TypeScript'],
  },
];

export const timelineCount = timelineData.length;
