/**
 * [T6b] series / moments 表单字段定义（**按写入口面 schema 逐字段对齐**）
 *
 * [为什么要单独一份字段表而不是 `schema-form` 自动生成]
 *   项目既有 `lib/schema-form`（ADR-007）是**由 zod schema 生成表单**的通用机制，
 *   但两者在这里都不合用，原因具体且可证：
 *     ① 写入口面 schema 是 `.loose()`，`Object.keys(schema.shape)` 只给键名、
 *        不给「中文标签 / 控件类型 / 提示语」，而这些是本页面的实际需求；
 *     ② `moments.images` 是**对象数组**（`{src, alt?}`），通用生成器对它只能给出
 *        「JSON 文本框」，而这里需要可增删的图片行编辑器（含 alt 输入框）；
 *     ③ series 的 `status` 是 enum（ongoing/completed），需要下拉而不是文本框。
 *
 *   ⇒ 采用「显式字段表 + 与 schema 的一致性测试」的组合（与 T4-1 的
 *     `POSTS_FRONTMATTER_COMPAT` 同一手法）：字段表给人读的标签与控件，
 *     **一致性由单测钉住**（字段名集合必须与写入口面 schema 相等），
 *     从而既拿到好用的表单，又不会与后端校验面漂移。
 *
 * [关键纪律：面板面对的是**写入口面**，不是构造面]
 *   构造面（`ShironeSeriesConstructSchema`）带 `.default()`；若面板照它渲染，
 *   用户没填的字段也会被提交上去，从而把默认值**物化进用户文件**
 *   （ADR-028 §21.2 记录的那类污染）。故本文件只认写入口面。
 */
import type { ShironeCollectionSubdir } from '@mizuki/shared';

/** 控件类型（渲染分派用） */
export type FieldKind = 'text' | 'textarea' | 'select' | 'number' | 'boolean' | 'date' | 'tags' | 'images';

export interface ContentFieldDef {
  /** frontmatter 键名（必须与写入口面 schema 的键逐字一致） */
  key: string;
  /** 中文标签（表单显示） */
  label: string;
  kind: FieldKind;
  /** 是否必填（由写入口面的必填键决定） */
  required: boolean;
  /** 占位提示 */
  placeholder?: string;
  /** select 的候选项 */
  options?: readonly { value: string; label: string }[];
  /** 字段下方的说明文字（讲清语义，减少用户猜） */
  help?: string;
}

/** series 字段表（3 键；必填仅 title） */
export const SERIES_FIELDS: readonly ContentFieldDef[] = Object.freeze([
  {
    key: 'title',
    label: '系列标题',
    kind: 'text',
    required: true,
    placeholder: '例如：Astro 主题开发笔记',
  },
  {
    key: 'status',
    label: '连载状态',
    kind: 'select',
    required: false,
    options: [
      { value: 'ongoing', label: '连载中' },
      { value: 'completed', label: '已完结' },
    ],
    help: '留空表示未设置（主题侧默认按连载中处理）。',
  },
  {
    key: 'defaultCategory',
    label: '默认分类',
    kind: 'text',
    required: false,
    placeholder: '该系列文章的默认分类名',
  },
]);

/** moments 字段表（7 键；必填仅 published） */
export const MOMENTS_FIELDS: readonly ContentFieldDef[] = Object.freeze([
  {
    key: 'published',
    label: '发布时间',
    kind: 'date',
    required: true,
    help: '必填。定义在写入口面里是 string | Date，面板统一提交 YYYY-MM-DD。',
  },
  {
    key: 'location',
    label: '地点',
    kind: 'text',
    required: false,
    placeholder: '例如：杭州',
  },
  {
    key: 'mood',
    label: '心情图标',
    kind: 'text',
    required: false,
    placeholder: '例如：material-symbols:sentiment-excited-outline-rounded',
    help: 'Iconify 图标名（主题按此渲染心情图标）。',
  },
  {
    key: 'tags',
    label: '标签',
    kind: 'tags',
    required: false,
    help: '回车添加；空数组即为「没有标签」。',
  },
  {
    key: 'images',
    label: '配图',
    kind: 'images',
    required: false,
    help: '每张图一个 src（站点 URL 形态，如 /images/xxx.jpg）与可选 alt。',
  },
  {
    key: 'pinned',
    label: '置顶',
    kind: 'boolean',
    required: false,
  },
  {
    key: 'draft',
    label: '草稿',
    kind: 'boolean',
    required: false,
  },
]);

/** 按集合取字段表 */
export function fieldsOf(kind: ShironeCollectionSubdir): readonly ContentFieldDef[] {
  return kind === 'series' ? SERIES_FIELDS : MOMENTS_FIELDS;
}

/** 集合中文名（页头与导航共用同一份，避免两处名字不一致） */
export const COLLECTION_TITLES: Readonly<Record<ShironeCollectionSubdir, string>> = Object.freeze({
  series: '系列',
  moments: '动态',
});

/** 集合说明（页面副标题） */
export const COLLECTION_DESCRIPTIONS: Readonly<Record<ShironeCollectionSubdir, string>> = Object.freeze({
  series: '管理 Shirone 的系列元数据（每篇一个 Markdown 文件，文件名即身份）',
  moments: '管理 Shirone 的短动态（含发布时间、心情、配图等）',
});

/**
 * 配图元素（与写入口面的 `images` 元素结构一致）。
 * 单独导出类型便于表单组件复用。
 */
export interface MomentImage {
  src: string;
  alt?: string;
}
