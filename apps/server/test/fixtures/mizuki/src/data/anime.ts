// anime 数据文件：官方 local 模式 canonical 形状（ADR-018）
// localAnimeList 为引擎管理的 initializer；getAnimeList 必须位于其后
// （golden 字节保持的后缀区，改数组不动函数）
import type { AnimeItem } from '../types';

export const localAnimeList: AnimeItem[] = [
  {
    title: '葬送的芙莉莲',
    status: 'watching',
    rating: 9.8,
    cover: '/images/anime/frieren.jpg',
    description: '勇者一行末端的魔法使踏上重访旧旅程的故事。',
    episodes: '28 episodes',
    year: '2023',
    genre: ['奇幻', '冒险'],
    studio: 'Madhouse',
    link: 'https://bgm.tv/subject/403768',
    progress: 20,
    totalEpisodes: 28,
    startDate: '2023-09',
  },
  {
    title: '命运石之门',
    status: 'completed',
    rating: 9.2,
    cover: '/images/anime/sgate.jpg',
    description: '围绕时间机器与世界线收束的科幻悬疑作。',
    episodes: '24 episodes',
    year: '2011',
    genre: ['科幻', '悬疑'],
    studio: 'White Fox',
    link: 'https://bgm.tv/subject/1907',
    progress: 24,
    totalEpisodes: 24,
    startDate: '2011-04',
    endDate: '2011-09',
  },
  {
    title: '魔法少女小圆',
    status: 'planned',
    rating: 9.0,
    cover: '/images/anime/madoka.jpg',
    description: '看似治愈实则致郁的魔法少女题材里程碑。',
    episodes: '12 episodes',
    year: '2011',
    genre: ['魔法少女', '剧情'],
    studio: 'SHAFT',
    link: 'https://bgm.tv/subject/2373',
    progress: 0,
    totalEpisodes: 12,
    startDate: '2011-01',
    endDate: '2011-04',
  },
];

export const getAnimeList = () => localAnimeList;
