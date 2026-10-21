/**
 * [U3-P4b/K2] 站点配置「物化态」四格语义（`GET /admin/config` 的 `overrides` 字段）
 * [职责] 把服务端 additive 字段 `overrides`（六域布尔 + siteInfo.keys + originalsKeys）
 *   分类为**四格**并给出该格要渲染的文案模型：
 *   - `missing`：字段缺失（旧后端 / 缓存响应）→ **不渲染**任何结论，console 无噪音；
 *   - `empty`：字段存在、六域全 false 且 `originalsKeys` 为空 → info「当前无物化…」；
 *   - `invalid`：非对象 / 任一域非 boolean / `siteInfo.keys` 非字符串数组 /
 *     `originalsKeys` 非数组 → 中性一行「物化态未知（视图字段异常）」，不发额外请求；
 *   - `active`：至少一域 true → warning，逐域列「已物化」+ 分域回退措辞。
 * [单源] 分类与文案只此一处：页面（SiteConfigPage.vue）只负责渲染，禁在模板里另做推断。
 * [边界] 入参是**不可信报文**（`unknown`），必须运行期自校验——不得用类型断言把
 *   异常响应当契约。本模块只读 `overrides`（`navEmptyTakeover` 仅用于合法格内的
 *   「空值接管」标注），不读 `view.nav` / `view.siteInfo` 的取值来反推接管态
 *   （那会把「基线不可得」误报成「未接管」，§1.4-D1）。
 *
 * 不留注释之外的约定：分域回退措辞照 K3 表逐字落地，**禁**统一承诺「可随时还原」
 * ——只有 lang / nav 有面板还原入口，comments 覆盖即管理权转移，其余三域无整档清除端点。
 */

/** 受控域键（顺序 = 冻结契约的键序，禁自造顺序） */
export type OverrideDomain = 'lang' | 'comments' | 'nav' | 'siteInfo' | 'profile' | 'announcement';

/** [K3] 分域还原口径（label = 面板分区名；revert = 该域**实际**可用的回退路径） */
export const OVERRIDE_DOMAIN_META: Record<OverrideDomain, { label: string; revert: string }> = {
  lang: {
    label: '语言（lang）',
    revert: '清空语言选择器即还原主题默认（服务端还原留档原文）',
  },
  comments: {
    label: '评论（commentConfig）',
    revert: '当前无面板还原入口：覆盖写入即管理权转移；原文本已在服务端留档',
  },
  nav: {
    label: '导航（navBarConfig）',
    revert: '导航区「还原主题默认」按钮',
  },
  siteInfo: {
    label: '站点信息（siteConfig）',
    revert: '当前无整档还原入口：逐键原文本已留档',
  },
  profile: {
    label: '个人资料（profileConfig）',
    revert: '当前无整档还原入口：原文本已留档',
  },
  announcement: {
    label: '公告（announcementConfig）',
    revert: '当前无整档还原入口：原文本已留档',
  },
};

/** 域渲染序（= 契约键序） */
export const OVERRIDE_DOMAINS: readonly OverrideDomain[] = [
  'lang',
  'comments',
  'nav',
  'siteInfo',
  'profile',
  'announcement',
];

/** 已物化域的一条事实（文案来自固定表，不由前端推断） */
export interface OverrideDomainFact {
  key: OverrideDomain;
  label: string;
  revert: string;
  /** 空值接管标注（nav = {links:[]} / siteInfo = {}） */
  emptyTakeover: boolean;
}

/**
 * 警示条渲染模型（刻意不用判别联合：模板只按 `kind` 选布局，
 * 不依赖跨元素类型收窄；`kind === 'missing'` 时页面**不渲染**）。
 */
export interface OverrideAlertModel {
  kind: 'missing' | 'invalid' | 'empty' | 'active';
  type: 'info' | 'warning';
  title: string;
  /** 非 active 格的一行补充说明（active 格为空串） */
  note: string;
  domains: OverrideDomainFact[];
  originalsKeys: string[];
}

/** 空值接管的判定输入（仅 active 格用；均取自 `view`，不参与四格判定） */
export interface OverrideClassifyOptions {
  /** `view.nav.links` 为空数组（overrides.nav 为 true 时 view.nav 即侧车值） */
  navEmptyTakeover?: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 布尔域取值：非 boolean → null（统一收口到「非法」格） */
function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

const MISSING_MODEL: OverrideAlertModel = {
  kind: 'missing',
  type: 'info',
  title: '',
  note: '',
  domains: [],
  originalsKeys: [],
};

const INVALID_MODEL: OverrideAlertModel = {
  kind: 'invalid',
  type: 'info',
  title: '物化态未知（视图字段异常）',
  note: '',
  domains: [],
  originalsKeys: [],
};

/**
 * 四格分类（唯一实现）。
 * 判据**只**用 `raw`（= `view.overrides`）；任何形状异常都退回中性一行，绝不猜结论。
 */
export function classifyOverrides(
  raw: unknown,
  options: OverrideClassifyOptions = {},
): OverrideAlertModel {
  // ① 键缺失：旧后端 / 缓存响应 → fail-open（不渲染、不报错、console 无噪音）
  if (raw === undefined) {
    return MISSING_MODEL;
  }
  // ② 非法：非对象 / siteInfo 非对象
  if (!isPlainObject(raw) || !isPlainObject(raw['siteInfo'])) {
    return INVALID_MODEL;
  }
  const siteInfoRaw = raw['siteInfo'];
  const lang = boolOrNull(raw['lang']);
  const comments = boolOrNull(raw['comments']);
  const nav = boolOrNull(raw['nav']);
  const profile = boolOrNull(raw['profile']);
  const announcement = boolOrNull(raw['announcement']);
  const siteInfoActive = boolOrNull(siteInfoRaw['active']);
  const siteInfoKeysRaw = siteInfoRaw['keys'];
  const originalsKeysRaw = raw['originalsKeys'];
  // ② 非法：任一域非 boolean / siteInfo.keys 非字符串数组 / originalsKeys 非数组
  if (
    lang === null ||
    comments === null ||
    nav === null ||
    profile === null ||
    announcement === null ||
    siteInfoActive === null ||
    !isStringArray(siteInfoKeysRaw) ||
    !Array.isArray(originalsKeysRaw)
  ) {
    return INVALID_MODEL;
  }
  // 元素类型不在判据内（只要求是数组）：渲染只取字符串项，非字符串项静默跳过
  const originalsKeys = originalsKeysRaw.filter((key): key is string => typeof key === 'string');
  const active: Record<OverrideDomain, boolean> = {
    lang,
    comments,
    nav,
    siteInfo: siteInfoActive,
    profile,
    announcement,
  };
  const domains: OverrideDomainFact[] = OVERRIDE_DOMAINS.filter((key) => active[key]).map(
    (key) => ({
      key,
      label: OVERRIDE_DOMAIN_META[key].label,
      revert: OVERRIDE_DOMAIN_META[key].revert,
      emptyTakeover:
        (key === 'nav' && options.navEmptyTakeover === true) ||
        (key === 'siteInfo' && siteInfoKeysRaw.length === 0),
    }),
  );

  // ③ 空：六域全 false。originalsKeys 非空是**可达**态（清除 override 不删留档，
  //    如 `PUT lang ''` 之后），故补一句留档提示，避免误示「什么都没有」。
  if (domains.length === 0) {
    return {
      kind: 'empty',
      type: 'info',
      title: '当前无物化：面板未接管任何受控键，主题 config.ts 常量改动仍会生效',
      note:
        originalsKeys.length === 0
          ? ''
          : `服务端仍保留 ${originalsKeys.length} 个留档键（清除过的域原文本不随清除删除，可由后续批次按需还原）`,
      domains: [],
      originalsKeys,
    };
  }

  // ④ 合法：至少一域 true
  return {
    kind: 'active',
    type: 'warning',
    title: `面板已物化 ${domains.length} 个受控键：${domains.map((item) => item.label).join('、')}`,
    note: '',
    domains,
    originalsKeys,
  };
}
