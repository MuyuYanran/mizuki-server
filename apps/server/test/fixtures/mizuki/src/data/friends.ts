// friends 数据文件：as const 覆盖点
import type { Friend } from '../types';

export const friendsData: Friend[] = [
  {
    id: 'f-001',
    title: 'Astro 官方博客',
    imgurl: 'https://astro.build/favicon.svg',
    desc: 'The web framework for content-driven websites',
    siteurl: 'https://astro.build/blog',
    tags: ['前端', 'astro'],
  },
  {
    id: 'f-002',
    title: 'TypeScript',
    imgurl: 'https://www.typescriptlang.org/icons/icon-48x48.png',
    siteurl: 'https://www.typescriptlang.org',
    tags: [],
  },
] as const;

export const friendsCount = friendsData.length;
