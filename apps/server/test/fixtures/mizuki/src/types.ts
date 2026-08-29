// fixture 类型定义集中处（数据文件 import type 引用，写回时不被触碰）
// [B2/裁决 9] diary/friends id 为 number（max+1 自动生成，ADR-014）；
// [Phase3-C2b/ADR-018] projects/skills/timeline id 为 string（官方名称串）、
// 枚举与必填面对齐官方；devices 恰 5 必填字段；anime 无 id（title 定位）。
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
  id: string;
  title: string;
  description: string;
  image: string;
  category: 'web' | 'mobile' | 'desktop' | 'other';
  techStack: string[];
  status: 'completed' | 'in-progress' | 'planned';
  startDate: string;
  liveDemo?: string;
  sourceCode?: string;
  endDate?: string;
  featured?: boolean;
  tags?: string[];
  visitUrl?: string;
}

export interface TimelineLink {
  name: string;
  url: string;
  type: 'website' | 'certificate' | 'project' | 'other';
}

export interface TimelineItem {
  id: string;
  title: string;
  description: string;
  type: 'education' | 'work' | 'project' | 'achievement';
  startDate: string;
  endDate?: string;
  location?: string;
  organization?: string;
  position?: string;
  skills?: string[];
  achievements?: string[];
  links?: TimelineLink[];
  icon?: string;
  color?: string;
  featured?: boolean;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'frontend' | 'backend' | 'database' | 'tools' | 'other';
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  experience: { years: number; months: number };
  projects?: string[];
  certifications?: string[];
  color?: string;
}

export interface Device {
  name: string;
  image: string;
  specs: string;
  description: string;
  link: string;
}


// [Phase3-C2b] anime 第七集合（官方 local 模式 AnimeItem，无 id 字段）
export interface AnimeItem {
  title: string;
  status: 'watching' | 'completed' | 'planned';
  rating: number;
  cover: string;
  description: string;
  episodes: string;
  year: string;
  genre: string[];
  studio: string;
  link: string;
  progress: number;
  totalEpisodes: number;
  startDate: string;
  endDate?: string;
}
