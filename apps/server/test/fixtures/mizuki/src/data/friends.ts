// friends 数据文件：as const 覆盖点
import type { Friend } from '../types';

export const friendsData: Friend[] = [
  {
    id: 1,
    title: 'Astro 官方博客',
    imgurl: 'https://astro.build/favicon.svg',
    desc: 'The web framework for content-driven websites',
    siteurl: 'https://astro.build/blog',
    tags: ['前端', 'astro'],
  },
  {
    id: 2,
    title: 'TypeScript',
    imgurl: 'https://www.typescriptlang.org/icons/icon-48x48.png',
    desc: 'TypeScript is JavaScript with syntax for types',
    siteurl: 'https://www.typescriptlang.org',
    tags: ['语言'],
  },
] as const;

export const friendsCount = friendsData.length;
