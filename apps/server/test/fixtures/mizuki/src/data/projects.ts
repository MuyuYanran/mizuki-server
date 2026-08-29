// projects 数据文件：satisfies 覆盖点
// [Phase3-C2b/ADR-018] 数据值迁移：id number→string、status 'done'→'completed'
// 与 'active'→'in-progress'、category 对齐官方枚举、补齐必填面（image/startDate）
import type { Project } from '../types';

export const projectsData: Project[] = [
  {
    id: '1',
    title: '个人博客',
    description: '基于 Astro 的个人博客，支持暗色模式与全文搜索。',
    image: '/images/projects/blog.png',
    category: 'web',
    techStack: ['Astro', 'TypeScript', 'Tailwind CSS'],
    status: 'completed',
    liveDemo: 'https://blog.example.com',
    sourceCode: 'https://github.com/example/blog',
    startDate: '2025-06-01',
    endDate: '2025-08-15',
    featured: true,
    tags: ['博客', '开源'],
    visitUrl: 'https://blog.example.com',
  },
  {
    id: '2',
    title: 'Mizuki 管理服务',
    description: 'Mizuki 博客的后端管理服务。',
    image: '/images/projects/mizuki-server.png',
    category: 'other',
    techStack: ['NestJS', 'SQLite'],
    status: 'in-progress',
    startDate: '2025-10-01',
    featured: false,
  },
] satisfies Project[];

export const projectsCount = projectsData.length;
