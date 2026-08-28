// fixture 类型定义集中处（数据文件 import type 引用，写回时不被触碰）
// [B2/裁决 9] 五类集合 id 迁移为 number（max+1 自动生成，ADR-014）；devices 为 grouped 无 id
export interface Diary {
  id: number;
  content: string;
  date: string;
  images?: string[];
  location?: string;
  mood?: string;
  tags?: string[];
}

export interface Friend {
  id: number;
  title: string;
  imgurl: string;
  desc?: string;
  siteurl: string;
  tags?: string[];
}

export interface Project {
  id: number;
  title: string;
  description?: string;
  image?: string;
  category?: string;
  techStack?: string[];
  status?: string;
  liveDemo?: string;
  sourceCode?: string;
  startDate?: string;
  endDate?: string;
  featured?: boolean;
  tags?: string[];
  visitUrl?: string;
}

export interface TimelineItem {
  id: number;
  title: string;
  description?: string;
  type: 'education' | 'certificate' | 'project' | 'other';
  icon?: string;
  color?: string;
  startDate: string;
  location?: string;
  organization?: string;
  skills?: string[];
  featured?: boolean;
}

export interface Skill {
  id: number;
  name: string;
  description?: string;
  icon?: string;
  category?: string;
  level?: number;
  experience?: { years: number; months: number };
  color?: string;
}

export interface Device {
  name: string;
  image?: string;
  specs?: string;
  description?: string;
  link?: string;
}
