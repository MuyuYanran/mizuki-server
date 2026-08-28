// diary 数据文件：块注释/行注释、单引号、尾随逗号、字符串含引号与换行
import type { Diary } from '../types';

/** 日记条目（fixture：字段以 REQUIREMENTS §6.3 为基线） */
export const diaryData: Diary[] = [
  // 第一条：单引号 + 尾随逗号
  {
    id: 1,
    content: '今天天气很好，\n去了海边——心情 "超级" 愉快。',
    date: '2026-01-01T08:00:00+08:00',
    images: ['beach.jpg',],
    location: '青岛',
    mood: 'sunny',
    tags: ['旅行', '海边',],
  },
  /* 第二条：块注释包裹 */
  {
    id: 2,
    content: '读完了《三体》，\n"给岁月以文明"。',
    date: '2026-02-14T21:30:00+08:00',
    images: [],
    mood: 'thoughtful',
    tags: ['读书',],
  },
];

// 文件尾：数据块外的代码与注释，写回时必须逐字节保留
export const diaryCount = diaryData.length;
