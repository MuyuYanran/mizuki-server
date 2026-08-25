// fixture 类型定义集中处（数据文件 import type 引用，写回时不被触碰）
export interface Diary {
  id: string;
  content: string;
  date: string;
  images?: string[];
  location?: string;
  mood?: string;
  tags?: string[];
}

export interface Friend {
  id: string;
  title: string;
  imgurl: string;
  desc?: string;
  siteurl: string;
  tags?: string[];
}

export interface Project {
  id: string;
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
  id: string;
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
  id: string;
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
