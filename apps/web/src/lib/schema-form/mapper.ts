/**
 * [P10b] zod schema → 表单字段描述符映射器
 * [职责] 遍历 ZodObject 的 shape，将每个字段的 ZodType 映射为前端可渲染的
 *   FieldDescriptor（控件类型 + 必填性 + 枚举选项 + 嵌套子字段）。
 *   表单字段、类型、必填性、枚举选项全部从 schema 推导，不为六类内容
 *   手写重复表单（P4 将 schema 放 shared 的动机在此兑现）。
 * [状态] ACTIVE
 *
 * 渲染策略选型（ADR-007）：自写映射器，不引入 zod-to-json-schema 等中间层。
 * 理由：六类 schema 字段类型有限（string/boolean/number/array/object/enum），
 * 自写映射器代码量小、零新依赖、对 zod v4 内省 API 直连；中间层反而引入
 * JSON Schema 的冗余抽象与额外依赖面。
 *
 * zod v4 内省 API（经实测）：
 * - ZodObject.shape → { key: ZodType }
 * - ZodOptional.isOptional() === true；.unwrap() → 内层 ZodType
 * - ZodEnum.options → string[]（枚举值）
 * - ZodArray.element → 元素 ZodType
 * - 各类型构造器名：ZodString / ZodBoolean / ZodNumber / ZodEnum /
 *   ZodArray / ZodObject / ZodOptional / ZodDefault。
 */
import type { z, ZodType, ZodObject, ZodOptional, ZodArray, ZodDefault } from 'zod';

/** 控件类型（与 Element Plus 控件一一对应） */
export type WidgetKind =
  | 'input'
  | 'textarea'
  | 'switch'
  | 'number'
  | 'select'
  | 'tags'
  | 'group';

/** 单个字段的渲染描述符（由 schema 推导，组件按此渲染） */
export interface FieldDescriptor {
  /** 字段名（提交时作为键；嵌套字段为子对象键） */
  key: string;
  /** 显示标签（默认取字段名，可由 LABEL_OVERRIDES 覆盖为中文） */
  label: string;
  widget: WidgetKind;
  /** 必填（schema 未声明 optional 即必填） */
  required: boolean;
  /** select 控件的枚举选项（来自 ZodEnum.options） */
  options?: string[];
  /** 占位提示文本（URL 字段等给输入提示） */
  placeholder?: string;
  /** group（嵌套对象）的子字段 */
  children?: FieldDescriptor[];
}

/** 字段名 → 中文标签覆盖（六类 schema 共用的语义化命名） */
const LABEL_OVERRIDES: Record<string, string> = {
  id: 'ID',
  title: '标题',
  name: '名称',
  content: '正文',
  desc: '描述',
  description: '描述',
  date: '日期',
  startDate: '开始日期',
  endDate: '结束日期',
  images: '图片',
  image: '图片',
  imgurl: '头像地址',
  siteurl: '站点地址',
  location: '位置',
  mood: '心情',
  tags: '标签',
  category: '分类',
  techStack: '技术栈',
  status: '状态',
  liveDemo: '演示地址',
  sourceCode: '源码地址',
  featured: '是否精选',
  visitUrl: '访问地址',
  type: '类型',
  icon: '图标',
  color: '颜色',
  organization: '组织',
  skills: '技能',
  level: '等级',
  experience: '经验',
  years: '年数',
  months: '月数',
  group: '分组',
  specs: '规格',
  link: '链接',
};

/** 长文本字段名白名单（命中 → textarea） */
const LONG_TEXT_FIELDS = new Set(['content', 'description', 'desc', 'specs']);

/** URL 字段名匹配（命中 → input + URL 提示） */
function isUrlField(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.includes('url') ||
    lower.includes('site') ||
    lower === 'link' ||
    lower === 'liveDemo' ||
    lower === 'sourcecode' ||
    lower === 'visiturl' ||
    lower === 'imgurl'
  );
}

/** 字段名 → 显示标签（覆盖表优先，否则原样返回） */
function labelFor(key: string): string {
  return LABEL_OVERRIDES[key] ?? key;
}

/** 取 ZodType 的构造器名（zod v4 无公开 typeName()，用 constructor.name 兜底） */
function typeName(t: ZodType): string {
  return t.constructor.name;
}

/**
 * 解包 optional/default，返回 [inner, required]。
 * - ZodOptional → required=false，解包内层
 * - ZodDefault → required 取内层，解包内层（默认值由表单初始化时从 schema 读）
 * - 其余 → required=true，原样返回
 */
function unwrapOptional(t: ZodType): { inner: ZodType; required: boolean } {
  let inner = t;
  let required = true;
  if (typeName(t) === 'ZodOptional') {
    required = false;
    inner = (t as unknown as ZodOptional<ZodType>).unwrap();
  }
  if (typeName(inner) === 'ZodDefault') {
    // default 隐含 optional 语义（有默认值即非必填）
    required = false;
    inner = (inner as unknown as ZodDefault<ZodType>).unwrap();
  }
  return { inner, required };
}

/** 单字段 → FieldDescriptor（递归处理嵌套 object） */
function describeField(key: string, raw: ZodType): FieldDescriptor {
  const { inner, required } = unwrapOptional(raw);
  const label = labelFor(key);
  const kind = typeName(inner);

  // 嵌套对象 → group + 递归子字段
  if (kind === 'ZodObject') {
    const childShape = (inner as ZodObject<Record<string, ZodType>>).shape;
    const children = Object.entries(childShape).map(([childKey, childType]) =>
      describeField(childKey, childType),
    );
    return { key, label, widget: 'group', required, children };
  }

  // 枚举 → select
  if (kind === 'ZodEnum') {
    // zod v4 的 ZodEnum.options 类型为 Values[keyof Values][]（联合），
    // 这里统一转 string —— 六类 schema 的枚举值均为字符串字面量。
    const raw = (inner as unknown as { options: readonly (string | number | symbol)[] }).options;
    return { key, label, widget: 'select', required, options: raw.map(String) };
  }

  // 数组（ZodArray<ZodString>）→ tags
  if (kind === 'ZodArray') {
    return { key, label, widget: 'tags', required };
  }

  // 布尔 → switch
  if (kind === 'ZodBoolean') {
    return { key, label, widget: 'switch', required };
  }

  // 数字 → number
  if (kind === 'ZodNumber') {
    return { key, label, widget: 'number', required };
  }

  // 字符串 → input / textarea / url 提示
  if (kind === 'ZodString') {
    if (LONG_TEXT_FIELDS.has(key)) {
      return { key, label, widget: 'textarea', required };
    }
    if (isUrlField(key)) {
      return {
        key,
        label,
        widget: 'input',
        required,
        placeholder: 'https://...',
      };
    }
    return { key, label, widget: 'input', required };
  }

  // 兜底：未知类型按文本输入处理（六类 schema 不应命中此处）
  return { key, label, widget: 'input', required };
}

/**
 * ZodObject schema → FieldDescriptor[]（表单渲染入口）。
 * 遍历 schema.shape 的每个字段，递归描述。
 */
export function describeSchema(schema: ZodObject<Record<string, ZodType>>): FieldDescriptor[] {
  const shape = schema.shape;
  return Object.entries(shape).map(([key, type]) => describeField(key, type));
}

/** 提交前用同一份 schema 在浏览器端 parse 一次，返回按字段路径索引的错误映射 */
export function validateBySchema(
  schema: ZodObject<Record<string, ZodType>>,
  value: unknown,
): Record<string, string> {
  const result = schema.safeParse(value);
  if (result.success) {
    return {};
  }
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.');
    // 只取首条错误（同字段多错误时首条足够提示）
    if (errors[path] === undefined) {
      errors[path] = issue.message;
    }
  }
  return errors;
}

/** 由 schema 推导空表单初值（按字段类型填充 null/空串/空数组/嵌套对象） */
export function emptyValueFromSchema(schema: ZodObject<Record<string, ZodType>>): Record<string, unknown> {
  const shape = schema.shape;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(shape)) {
    const { inner, required } = unwrapOptional(raw);
    const kind = typeName(inner);
    if (kind === 'ZodObject') {
      const childShape = (inner as ZodObject<Record<string, ZodType>>).shape;
      const child: Record<string, unknown> = {};
      for (const [childKey, childRaw] of Object.entries(childShape)) {
        const { inner: childInner } = unwrapOptional(childRaw);
        child[childKey] = defaultValueFor(childInner);
      }
      out[key] = child;
    } else {
      out[key] = required ? defaultValueFor(inner) : null;
    }
  }
  return out;
}

function defaultValueFor(t: ZodType): unknown {
  switch (typeName(t)) {
    case 'ZodString':
      return '';
    case 'ZodNumber':
      return 0;
    case 'ZodBoolean':
      return false;
    case 'ZodArray':
      return [];
    case 'ZodEnum':
      return '';
    default:
      return '';
  }
}
