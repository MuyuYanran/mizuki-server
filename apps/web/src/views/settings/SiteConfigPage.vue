<script setup lang="ts">
/**
 * [Phase3-C7] 站点配置页（override 批，ADR-020）
 * [职责] 受控子集管理：siteConfig.lang（语言（可选），C5 面板形态同型：
 *   placeholder 'en'、空 = 站点默认不落键）+ commentConfig 表单（schema-form
 *   驱动，字段面对齐主题类型定义零删减；commentConfig 无真 secret 键 → 无脱敏
 *   语义，T1.1 结论）。一页一查一存：GET /admin/config 整体读，保存经
 *   PUT lang + PUT comments 分立写。
 * [U3-P1] 配置域一期：新增三档区（K8 五区 el-collapse）——
 *   站点信息（siteConfig 15 受管键：13 键 schema-form + banner/font 两个 JSON
 *   textarea，整档一个 PUT = K9 一次请求）/ 个人资料（profileConfig，links 走
 *   mapper 既有 json widget）/ 公告（announcementConfig），各自独立保存按钮；
 *   评论与导航两区行为不变（导航仍保「还原主题默认」通道）。
 * [U3-P4a/K8] 增「番剧与 B 站」分区（折叠默认收起）：anime / bangumi / bilibili 三域由
 *   shared SiteAnimeSchema 驱动渲染（anime.mode 为下拉），保存走 PUT /admin/config/anime。
 *   面板负责**全字段回填**（override 优先、基线回落）——服务端是「按域整对象替换」，
 *   未回填的子键会被移除（分区内已有明确提示）。
 * [U3-P4c/K15] 增「特效」分区（与「番剧与 B 站」并列、默认收起）：musicPlayer / sakura /
 *   pio 三域对应 config.ts 的顶层声明 musicPlayerConfig / sakuraConfig / pioConfig，
 *   标量键由 shared 子 schema 驱动，结构化子键（sakura.size/opacity/speed、pio.dialog）
 *   走 JSON textarea + 服务端整值置换；保存 **一次** PUT /admin/config/effects 提交三域
 *   （服务端整档重写 sidecar override，只交一域会丢其它域记录）。`meting_api` 不得出现在
 *   表单里（含凭据，后端也不接受）。
 * [边界] 仅受控子集；其余 config.ts 字段不在面板管理面（.strict() 兜底禁蔓延）；
 *   三档均无逐键/清除入口（K1 裁剪，侧车原文留档仍在服务端）；
 *   保存后需经「构建预览」执行 build 任务才反映到站点 dist（生效链）。
 */
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { z, type ZodObject, type ZodType } from 'zod';
import {
  AnnouncementConfigSchema,
  CommentConfigSchema,
  MizukiTier1Profile,
  ProfileConfigSchema,
  SITE_ANIME_KEYS,
  SITE_EFFECTS_KEYS,
  SITE_LANG_PATTERN,
  SiteAnimeSchema,
  SiteEffectsSchema,
  SiteInfoSchema,
  SiteMusicPlayerSchema,
  SitePioSchema,
  SiteSakuraSchema,
} from '@mizuki/shared';
import { configApi, type SiteEffectsDomainMap } from '../../api/config';
import { ApiError } from '../../api/http';
import { SchemaForm, emptyValueFromSchema } from '../../lib/schema-form';
import { notifyApiError } from '../../lib/notify';

const loading = ref(false);
const saving = ref(false);
/** 语言（可选）：'' = 未设置（站点默认）；回显 override 态，基线值仅作对照展示 */
const lang = ref('');
/**
 * [Phase4-D4/配套2] 语言输入改 el-select（allow-create）：选项源 = Tier1 档案
 * i18nSupport.siteLangUnion（T1.3 主题根实测支持集）；allow-create 保留连字符形
 * 等档案外合法值入口（siteLangSchema [-_] 双兼容为权威，选择器仅为体验层）。
 */
const langOptions: string[] = MizukiTier1Profile.i18nSupport?.siteLangUnion ?? [];
const baselineLang = ref<string | null>(null);
const baselineUnavailable = ref(false);
const formValue = ref<Record<string, unknown>>(emptyValueFromSchema(CommentConfigSchema as ZodObject<Record<string, ZodType>>));

// ── [Phase4-D3] 导航管理（#8，T1.5 决策 = JSON textarea 兜底，C2b links 先例同构） ──
/** 导航 JSON 文本（links 数组本体；初值 override 优先，否则基线，均无 = 空表单起步） */
const navJson = ref('[]');
/** 基线 nav 对照文本（不可得 → null） */
const baselineNavText = ref<string | null>(null);
/**
 * [U3-P2/K6] navBarConfig 初始化器原文（ADMIN 视图 K5 增量字段）：基线解析失败
 * （真实主题含 LinkPreset 标识符）时的原文对照；解析成功时仍可用作交叉核对。
 */
const baselineNavRaw = ref<string | null>(null);
/** 接管态（view.nav === null = 面板尚未管理导航，当前生效的是主题声明） */
const navUnmanaged = ref(false);
/** 基线不可得（真实主题 navbar 含 LinkPreset 标识符 → 降级分支，ADR-020 追加节） */
const navBaselineUnavailable = ref(false);

// ── [U3-P1] K8 五区折叠：站点信息 / 评论 / 导航 / 个人资料 / 公告 ──
/** 展开区（默认展开站点信息；评论与导航两个既有区保持可折叠但默认收起） */
const activeSections = ref<string[]>(['site-info']);

// ── [U3-P1] 站点信息档（siteConfig 15 受管键；K5 分派：13 键 schema-form + banner/font JSON） ──
/**
 * 13 表单键视图：整档 schema 去 banner/font 两键——两键形态为联合/嵌套对象
 * （banner.src 三种形态、font 两档字体），K5 判定由 JSON textarea 承载，故不
 * 进 schema-form（omit 产物仍 .strict()，字段面零删减、零改名）。
 */
const SITE_INFO_FORM_SCHEMA = SiteInfoSchema.omit({
  banner: true,
  font: true,
}) as unknown as ZodObject<Record<string, ZodType>>;
/** 可选键集（K7 口径：siteStartDate / navbarTitle / pageScaling / tagStyle）——
 * 基线缺该键时表单不送（零触碰，禁凭空落键）；运行时自
 *  schema 内省（ZodOptional 包装判定），不与 shared 语义重复维护。
 *  [U3-P2/K7] wallpaperMode 已收紧为必填（主题类型即必填），故自动退出本集合。 */
const SITE_INFO_OPTIONAL_KEYS = new Set(
  Object.entries(SITE_INFO_FORM_SCHEMA.shape)
    .filter(([, type]) => type.constructor.name === 'ZodOptional')
    .map(([key]) => key),
);
const siteFormValue = ref<Record<string, unknown>>(emptyValueFromSchema(SITE_INFO_FORM_SCHEMA));
const siteBannerJson = ref('{}');
const siteFontJson = ref('{}');
/** 声明形态不符（siteConfig 非对象字面量）→ 基线不可得；门禁会 409，面板显式警示 */
const siteInfoUnavailable = ref(false);
const baselineSiteInfoText = ref<string | null>(null);
const savingSite = ref(false);

// ── [U3-P1] 个人资料档 / 公告档 ──
const profileFormValue = ref<Record<string, unknown>>(
  emptyValueFromSchema(ProfileConfigSchema as ZodObject<Record<string, ZodType>>),
);
const profileUnavailable = ref(false);
const savingProfile = ref(false);
const announcementFormValue = ref<Record<string, unknown>>(
  emptyValueFromSchema(AnnouncementConfigSchema as ZodObject<Record<string, ZodType>>),
);
const announcementUnavailable = ref(false);
const savingAnnouncement = ref(false);

// ── [U3-P4a/K8] 番剧与 B 站分区（siteConfig 的 anime / bangumi / bilibili 三键） ──
/**
 * 表单 schema = shared 聚合档（三域必填 + 域内每字段可选 + .strict()）。
 * 键面完全由 shared 驱动（schema-form 渲染：anime.mode → 下拉、布尔 → 开关、
 * 字符串 → 输入框），前端不复制任何字段名。
 */
const ANIME_FORM_SCHEMA = SiteAnimeSchema as unknown as ZodObject<Record<string, ZodType>>;
/** 表单初值：三域恒在（域内键按「override 优先、基线回落」全字段回填） */
const animeFormValue = ref<Record<string, unknown>>(emptyAnimeFormValue());
const savingAnime = ref(false);

/** 空档起步：三域对象各为空（域内每字段可选，空对象是合法值） */
function emptyAnimeFormValue(): Record<string, unknown> {
  return { anime: {}, bangumi: {}, bilibili: {} };
}

/**
 * [K8] 全字段回填：effective（逐域 override 优先、基线回落）→ 表单值。
 * 必须回填**全部**已有键——物化是「按域整对象替换」，未回填的键会被移除。
 */
function animeFormValueOf(
  effective: Record<string, Record<string, unknown>> | undefined,
): Record<string, unknown> {
  const out = emptyAnimeFormValue();
  for (const domain of SITE_ANIME_KEYS) {
    const value = effective?.[domain];
    if (value !== undefined) {
      out[domain] = { ...value };
    }
  }
  return out;
}

// ── [U3-P4c/K15] 特效分区（config.ts 三个**顶层声明**；默认收起） ──
/**
 * 域 = shared 的三域键序单源（`SITE_EFFECTS_KEYS`：musicPlayer / sakura / pio）。
 * 三域在服务端对应 `musicPlayerConfig` / `sakuraConfig` / `pioConfig` 三个顶层声明
 * （`widgetConfigs` 里的成员只是标识符引用，面板与后端都不碰它）。
 */
type EffectsDomain = (typeof SITE_EFFECTS_KEYS)[number];

/**
 * 表单面拆分（与站点信息区 banner/font 同法，K15 的 dialog 口径同源）：
 * - 标量键 → schema-form 驱动（字段面仍由 shared 子 schema 推导，前端零字段名复制）；
 * - 结构化键（`sakura.size/opacity/speed`、`pio.dialog`）→ JSON textarea 兜底：
 *   它们是 `.refine()` / union / tuple 包装，mapper 无法安全推导控件形态（会退化成
 *   纯文本输入并把对象当字符串提交），故整值以 JSON 编辑、服务端按整值置换（K11）。
 */
const EFFECTS_JSON_KEYS: Record<EffectsDomain, readonly string[]> = {
  musicPlayer: [],
  sakura: ['size', 'opacity', 'speed'],
  pio: ['dialog'],
};

/** 面板表单 schema：三域聚合，剔掉上面由 JSON 承载的结构化键（字段名仍来自 shared） */
const EFFECTS_FORM_SCHEMA = z.object({
  musicPlayer: SiteMusicPlayerSchema,
  sakura: SiteSakuraSchema.omit({ size: true, opacity: true, speed: true }),
  pio: SitePioSchema.omit({ dialog: true }),
}) as unknown as ZodObject<Record<string, ZodType>>;

/** JSON 兜底字段清单（domain.key → textarea；label 直接展示所属域，避免同名键歧义） */
interface EffectsJsonField {
  path: string;
  label: string;
}
const EFFECTS_JSON_FIELDS: EffectsJsonField[] = SITE_EFFECTS_KEYS.flatMap((domain) =>
  EFFECTS_JSON_KEYS[domain].map((key) => ({ path: `${domain}.${key}`, label: `${domain}.${key}` })),
);

/** 三域表单值（域内键全字段回填；未回填的可选键 = undefined，提交时剔除） */
const effectsFormValue = ref<Record<string, unknown>>(emptyEffectsFormValue());
/** JSON 兜底文本（键 = `domain.key`；空串 = 不提交该键） */
const effectsJson = ref<Record<string, string>>({});
/** 域不可得（既无 override 也无基线：声明缺失/形态不符）→ 该域只读并跳过提交 */
const effectsUnavailable = ref<Record<EffectsDomain, boolean>>({
  musicPlayer: false,
  sakura: false,
  pio: false,
});
const savingEffects = ref(false);

/** 空档起步：三域各为 {}（域内每字段可选，空对象合法） */
function emptyEffectsFormValue(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const domain of SITE_EFFECTS_KEYS) {
    out[domain] = {};
  }
  return out;
}

/** [K15] 全字段回填：effects（逐域 override 逐键回落基线）→ 标量表单值 + JSON 文本 */
function applyEffectsValue(effects: SiteEffectsDomainMap | undefined): void {
  const form = emptyEffectsFormValue();
  const json: Record<string, string> = {};
  const unavailable: Record<EffectsDomain, boolean> = {
    musicPlayer: false,
    sakura: false,
    pio: false,
  };
  for (const domain of SITE_EFFECTS_KEYS) {
    const domainValue = effects?.[domain] ?? null;
    unavailable[domain] = domainValue === null;
    if (domainValue === null) {
      continue;
    }
    const jsonKeys = EFFECTS_JSON_KEYS[domain];
    const formDomain: Record<string, unknown> = {};
    for (const [key, fieldValue] of Object.entries(domainValue)) {
      if (!jsonKeys.includes(key)) {
        formDomain[key] = fieldValue;
      }
    }
    form[domain] = formDomain;
    for (const key of jsonKeys) {
      const structured = domainValue[key];
      json[`${domain}.${key}`] = structured === undefined ? '' : JSON.stringify(structured, null, 2);
    }
  }
  effectsFormValue.value = form;
  effectsJson.value = json;
  effectsUnavailable.value = unavailable;
}

function setEffectsJson(path: string, text: string): void {
  effectsJson.value = { ...effectsJson.value, [path]: text };
}

/** 页面级标签覆盖（[Phase3-C7] describeSchema labels 参数；不污染全局覆盖表） */
const CONFIG_LABELS: Record<string, string> = {
  enable: '启用',
  system: '评论系统',
  twikoo: 'Twikoo 配置',
  giscus: 'Giscus 配置',
  envId: '服务地址（envId）',
  region: '区域（region）',
  lang: '语言',
  repo: '仓库（repo）',
  repoId: '仓库 ID（repoId）',
  category: '分类（category）',
  categoryId: '分类 ID（categoryId）',
  mapping: '关联方式（mapping）',
  strict: '严格模式（strict）',
  reactionsEnabled: '表情反应开关',
  emitMetadata: '元数据上报',
  inputPosition: '输入框位置',
  theme: '主题配色',
  loading: '加载方式',
  // [U3-P1] 站点信息档 / 个人资料档 / 公告档（同名键取上下文中性标签：面板分区已给出语义）
  title: '标题',
  subtitle: '副标题',
  siteURL: '站点地址（siteURL）',
  siteStartDate: '建站日期',
  timeZone: '时区偏移（-12~12）',
  themeColor: '主题色',
  hue: '色相（0~360）',
  fixed: '固定色相',
  featurePages: '功能页开关',
  anime: '番剧页',
  diary: '日记页',
  friends: '友链页',
  projects: '项目页',
  skills: '技能页',
  timeline: '时间线页',
  albums: '相册页',
  devices: '设备页',
  navbarTitle: '导航栏标题',
  mode: '展示模式',
  text: '文字',
  icon: '图标（iconify）',
  logo: 'Logo 路径',
  postListLayout: '文章列表布局',
  defaultMode: '默认布局',
  allowSwitch: '允许切换布局',
  categoryBar: '分类栏',
  tagStyle: '标签样式',
  useNewStyle: '使用新标签样式',
  wallpaperMode: '壁纸模式',
  showModeSwitchOnMobile: '移动端模式切换器',
  pageScaling: '页面缩放',
  targetWidth: '目标宽度（px）',
  toc: '目录（TOC）',
  mobileTop: '移动端顶部目录',
  desktopSidebar: '桌面端侧栏目录',
  floating: '浮动目录',
  depth: '目录深度（1~3）',
  useJapaneseBadge: '日语标签徽章',
  name: '名称（昵称）',
  avatar: '头像地址',
  bio: '个性签名',
  links: '社交链接',
  typewriter: '打字机效果',
  speed: '速度',
  url: '链接地址',
  external: '新窗口打开',
  content: '内容',
  type: '类型',
  closable: '可关闭',
  link: '公告链接',
  // [U3-P4a/K8] 番剧与 B 站分区（anime / mode 两个同名键在 ANIME_LABELS 内单独覆盖）
  bangumi: 'Bangumi 数据源',
  bilibili: 'B 站数据源',
  userId: 'Bangumi 用户 ID（userId）',
  vmid: 'B 站用户 ID（vmid）',
  fetchOnDev: '开发环境也拉取数据',
  coverMirror: '封面镜像源（coverMirror）',
  useWebp: '使用 WebP 封面',
};

/** 番剧与 B 站分区的标签覆盖（anime / mode 与站点信息区的同名键语义不同） */
const ANIME_LABELS: Record<string, string> = {
  ...CONFIG_LABELS,
  anime: '番剧页面（anime）',
  mode: '页面模式（bangumi / local / bilibili）',
};

/** [U3-P4c/K15] 特效分区的标签覆盖（三域同名键取域内中性文案；分区标题已给出所属声明） */
const EFFECTS_LABELS: Record<string, string> = {
  ...CONFIG_LABELS,
  musicPlayer: '音乐播放器（musicPlayerConfig）',
  sakura: '樱花（sakuraConfig）',
  pio: '看板娘（pioConfig）',
  enable: '启用',
  showFloatingPlayer: '显示悬浮播放器',
  floatingEntryMode: '悬浮入口模式（default / fab）',
  mode: '模式（音乐 meting / local；看板娘 static / fixed / draggable）',
  id: '歌单 ID（id）',
  server: '音乐源服务器（server）',
  type: '播单类型（type）',
  sakuraNum: '樱花数量（0~500）',
  limitTimes: '越界限制次数（-1 = 无限）',
  zIndex: '层级（zIndex，-1000~10000）',
  models: '模型文件路径（逗号分隔）',
  position: '位置（left / right）',
  width: '宽度（px，1~4000）',
  height: '高度（px，1~4000）',
  hiddenOnMobile: '移动端隐藏',
};

async function fetchConfig(): Promise<void> {
  loading.value = true;
  try {
    const view = await configApi.getConfig();
    lang.value = view.siteConfig.lang ?? '';
    baselineLang.value = view.siteConfig.baselineLang;
    // 基线不可得（config.ts 缺声明/含未支持节点）→ 空表单起步（ADR-020 已知限制）
    baselineUnavailable.value = view.commentConfig === null;
    formValue.value =
      (view.commentConfig as Record<string, unknown> | null) ??
      emptyValueFromSchema(CommentConfigSchema as ZodObject<Record<string, ZodType>>);
    // [U3-P2/K6] nav：override 优先回显；基线解析成功 → 结构化对照文本，否则退回
    // 初始化器原文（含 LinkPreset 预设，用户仍能看到主题默认导航长什么样）
    navBaselineUnavailable.value = view.baselineNav === null;
    navUnmanaged.value = view.nav === null;
    navJson.value = JSON.stringify(view.nav?.links ?? [], null, 2);
    baselineNavText.value = view.baselineNav ? JSON.stringify(view.baselineNav.links, null, 2) : null;
    baselineNavRaw.value = view.baselineNavRaw ?? null;
    // [U3-P1] 站点信息档：13 键进表单、banner/font 进 JSON textarea、基线只读对照
    siteInfoUnavailable.value = view.siteInfo === null;
    siteFormValue.value = siteFormValueOf(view.siteInfo);
    siteBannerJson.value = JSON.stringify(view.siteInfo?.['banner'] ?? {}, null, 2);
    siteFontJson.value = JSON.stringify(view.siteInfo?.['font'] ?? {}, null, 2);
    baselineSiteInfoText.value = view.baselineSiteInfo
      ? JSON.stringify(view.baselineSiteInfo, null, 2)
      : null;
    // [U3-P1] 个人资料 / 公告：override 优先，否则基线，均不可得 = 空表单起步
    profileUnavailable.value = view.profile === null;
    profileFormValue.value =
      (view.profile as Record<string, unknown> | null) ??
      emptyValueFromSchema(ProfileConfigSchema as ZodObject<Record<string, ZodType>>);
    announcementUnavailable.value = view.announcement === null;
    announcementFormValue.value =
      (view.announcement as Record<string, unknown> | null) ??
      emptyValueFromSchema(AnnouncementConfigSchema as ZodObject<Record<string, ZodType>>);
    // [U3-P4a/K8] 番剧与 B 站：effective 全字段回填（override 优先、基线回落）
    animeFormValue.value = animeFormValueOf(view.anime.effective);
    // [U3-P4c/K15] 特效三档：逐域全字段回填（override 逐键回落基线；meting_api 从不出现）
    applyEffectsValue(view.effects);
  } catch (e) {
    notifyApiError(e, '加载站点配置失败');
  } finally {
    loading.value = false;
  }
}

/**
 * [U3-P1] siteInfo 表单初值：schema 空值起步 + 服务端视图（override 优先）逐键覆盖。
 * 基线缺该键时的两态（K7/additive 语义）：
 * - 可选键（siteStartDate / navbarTitle / pageScaling / tagStyle / wallpaperMode）→
 *   置 undefined 不送（零触碰，禁凭空落键）；注意空值起步会把日期键填成「今天」，
 *   故必须显式抹回 undefined；
 * - 必填键 → 保留 schema 空值（提交时由本地/服务端校验拦下，不会静默落错值）。
 */
function siteFormValueOf(info: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = emptyValueFromSchema(SITE_INFO_FORM_SCHEMA);
  for (const key of Object.keys(SITE_INFO_FORM_SCHEMA.shape)) {
    const value = info?.[key];
    if (value !== undefined) {
      out[key] = value;
    } else if (SITE_INFO_OPTIONAL_KEYS.has(key)) {
      out[key] = undefined;
    }
  }
  return out;
}

/** [U3-P1] banner/font JSON textarea 解析（非法 JSON / 非对象 → null，字段级形状由 schema 权威兜底） */
function parseJsonObject(text: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

/** 校验失败 → 首条 issue 的路径 + 文案（面板只给首条，与 schema-form 口径一致） */
function firstIssueOf(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const issue = error.issues[0];
  if (issue === undefined) {
    return '配置校验未通过';
  }
  const path = issue.path.map((part) => String(part)).join('.');
  return path === '' ? issue.message : `${path}：${issue.message}`;
}

/**
 * 可选键空串归一为不落键（面板语义：空 = 未设置，与 C5 面板同型）——
 * 必填键（enable/envId/giscus 12 键）原样提交，空串即用户显式输入。
 */
function normalizeComments(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...value };
  if (out['system'] === '') {
    delete out['system'];
  }
  if (typeof out['twikoo'] === 'object' && out['twikoo'] !== null) {
    const twikoo = { ...(out['twikoo'] as Record<string, unknown>) };
    if (twikoo['region'] === '') {
      delete twikoo['region'];
    }
    if (twikoo['lang'] === '') {
      delete twikoo['lang'];
    }
    out['twikoo'] = twikoo;
  }
  return out;
}

async function onSubmit(value: Record<string, unknown>): Promise<void> {
  // [Phase4-D4/S2/A4b] 清除意图防吞：el-select clearable 实证经 useEmptyValues 发
  // undefined（DEFAULT_VALUE_ON_CLEAR = void 0），@clear 兜底为 ''，此处再 ?? '' 收口——
  // 保证任何空值路径（undefined/null）都归一为''清除指令，且 lang 校验仅作用于非空值
  // （空值直达 putLang，禁被表单校验/空值省略吞掉）。线上清除契约 = ''（PutLangBodySchema
  // 的 siteLangSchema 对 null 恒 400，e2e p7f ⑭ 权威），不发 null。
  const langTrim = (lang.value ?? '').trim();
  if (langTrim !== '' && !SITE_LANG_PATTERN.test(langTrim)) {
    ElMessage.warning('语言仅允许字母数字，以连字符或下划线分段（如 en / zh-Hans / zh_CN）');
    return;
  }
  saving.value = true;
  try {
    await configApi.putLang(langTrim);
    await configApi.putComments(normalizeComments(value));
    ElMessage.success('站点配置已保存；如需反映到站点请在「构建预览」执行 build');
    await fetchConfig();
  } catch (e) {
    notifyApiError(e, '保存站点配置失败');
  } finally {
    saving.value = false;
  }
}

/**
 * [Phase4-D3] 导航 JSON 输入守卫（零 any）：解析失败 / 非数组 / 元素非对象 → null
 * （字段级形状校验由服务端 zod .strict() 权威兜底，400 issues 回显——C2b 同构口径）。
 */
function parseNavInput(text: string): Record<string, unknown>[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  const items: Record<string, unknown>[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return null;
    }
    items.push(item as Record<string, unknown>);
  }
  return items;
}

/**
 * 保存导航：空数组 = 合法清空导航（破坏性语义，二次确认）；其余交服务端校验。
 * [U3-P2/K6] 接管确认：面板尚未管理导航（nav === null）且基线不可解析（含 LinkPreset
 * 预设）时，首次保存会把主题的预设导航整体替换掉——此处显式告知并二次确认。原文
 * 已在首次物化时留档，故「还原主题默认」可回滚。
 * 两种情形合并为**一次**确认，不叠两层弹窗：
 * - links 非空 → 接管提示；
 * - links 为空 → 在既有「空导航」文案前加同义接管提示（仍是单次确认）。
 * override 已存在（nav 非 null）→ 维持现状（空数组仍走既有确认）。
 */
async function onSaveNav(): Promise<void> {
  const links = parseNavInput(navJson.value);
  if (links === null) {
    ElMessage.warning('导航内容须为 JSON 数组（元素为对象），请检查格式');
    return;
  }
  // [U3-P2/K6] 接管态判定：nav === null（无 override）∧ 基线解析不可得
  const takeover = navUnmanaged.value && navBaselineUnavailable.value;
  const TAKEOVER_HINT =
    '主题默认导航含 LinkPreset 预设（基线不可解析），保存后预设将被替换；原文已留档，可经「还原主题默认」恢复。';
  if (links.length === 0) {
    const confirmed = await ElMessageBox.confirm(
      `${takeover ? `${TAKEOVER_HINT}\n\n` : ''}将保存空导航：前台导航栏将被清空（构建预览执行 build 后生效）。确定继续？`,
      takeover ? '接管导航且清空确认' : '空导航二次确认',
      { type: 'warning', confirmButtonText: '确认清空', cancelButtonText: '取消' },
    )
      .then(() => true)
      .catch(() => false);
    if (!confirmed) {
      return;
    }
  } else if (takeover) {
    const confirmed = await ElMessageBox.confirm(TAKEOVER_HINT + '确定保存？', '接管主题导航确认', {
      type: 'warning',
      confirmButtonText: '确认接管',
      cancelButtonText: '取消',
    })
      .then(() => true)
      .catch(() => false);
    if (!confirmed) {
      return;
    }
  }
  saving.value = true;
  try {
    await configApi.putNav(links);
    ElMessage.success('导航已保存；如需反映到站点请在「构建预览」执行 build');
    await fetchConfig();
  } catch (e) {
    notifyApiError(e, '保存导航失败');
  } finally {
    saving.value = false;
  }
}

/** 还原主题默认导航：links 缺键 = 清除 override（config.ts 还原留档原文本；无 override 时服务端 no-op） */
async function onResetNav(): Promise<void> {
  saving.value = true;
  try {
    await configApi.putNav(undefined);
    ElMessage.success('已还原主题默认导航（清除面板管理）');
    await fetchConfig();
  } catch (e) {
    notifyApiError(e, '还原导航失败');
  } finally {
    saving.value = false;
  }
}


/**
 * [U3-P1/K9] 保存站点信息：13 表单键（schema-form 已本地校验）+ banner/font 两个
 * JSON textarea → 整档 zod 校验 → **一个** PUT /admin/config/site-info（15 键整档）。
 * JSON 解析失败或整档校验不过一律不发请求（K9 前置校验）。
 */
async function onSaveSiteInfo(value: Record<string, unknown>): Promise<void> {
  const banner = parseJsonObject(siteBannerJson.value);
  if (banner === null) {
    ElMessage.warning('banner 配置须为 JSON 对象（如 { "src": "/images/banner.webp", "credit": { … } }）');
    return;
  }
  const font = parseJsonObject(siteFontJson.value);
  if (font === null) {
    ElMessage.warning('font 配置须为 JSON 对象（如 { "asciiFont": { … }, "cjkFont": { … } }）');
    return;
  }
  const parsed = SiteInfoSchema.safeParse({ ...value, banner, font });
  if (!parsed.success) {
    ElMessage.warning(`站点信息校验未通过：${firstIssueOf(parsed.error)}`);
    return;
  }
  savingSite.value = true;
  try {
    await configApi.putSiteInfo(parsed.data as Record<string, unknown>);
    ElMessage.success('站点信息已保存；如需反映到站点请在「构建预览」执行 build');
    await fetchConfig();
  } catch (e) {
    notifyApiError(e, '保存站点信息失败');
  } finally {
    savingSite.value = false;
  }
}

/** [U3-P1/K9] 保存个人资料（独立按钮；links 由 mapper 既有 json widget 承载，[] = 合法清空） */
async function onSaveProfile(value: Record<string, unknown>): Promise<void> {
  const parsed = ProfileConfigSchema.safeParse(value);
  if (!parsed.success) {
    ElMessage.warning(`个人资料校验未通过：${firstIssueOf(parsed.error)}`);
    return;
  }
  savingProfile.value = true;
  try {
    await configApi.putProfile(parsed.data as Record<string, unknown>);
    ElMessage.success('个人资料已保存；如需反映到站点请在「构建预览」执行 build');
    await fetchConfig();
  } catch (e) {
    notifyApiError(e, '保存个人资料失败');
  } finally {
    savingProfile.value = false;
  }
}

/** [U3-P1/K9] 保存公告（独立按钮；content 非空必填由 schema 兜底） */
async function onSaveAnnouncement(value: Record<string, unknown>): Promise<void> {
  const parsed = AnnouncementConfigSchema.safeParse(value);
  if (!parsed.success) {
    ElMessage.warning(`公告校验未通过：${firstIssueOf(parsed.error)}`);
    return;
  }
  savingAnnouncement.value = true;
  try {
    await configApi.putAnnouncement(parsed.data as Record<string, unknown>);
    ElMessage.success('公告已保存；如需反映到站点请在「构建预览」执行 build');
    await fetchConfig();
  } catch (e) {
    notifyApiError(e, '保存公告失败');
  } finally {
    savingAnnouncement.value = false;
  }
}

/**
 * [U3-P4a/K8] 保存番剧与 B 站：三域**按域整对象替换**（面板已全字段回填）。
 * 本地先过一遍 SiteAnimeSchema（越界键/枚举值当场拦下，避免无谓 400）。
 */
async function onSaveAnime(value: Record<string, unknown>): Promise<void> {
  const parsed = SiteAnimeSchema.safeParse(value);
  if (!parsed.success) {
    ElMessage.warning(`番剧与 B 站配置校验未通过：${firstIssueOf(parsed.error)}`);
    return;
  }
  savingAnime.value = true;
  try {
    await configApi.putSiteAnime(parsed.data as Record<string, unknown>);
    ElMessage.success('番剧与 B 站配置已保存；如需反映到站点请在「构建预览」执行 build');
    await fetchConfig();
  } catch (e) {
    notifyApiError(e, '保存番剧与 B 站配置失败');
  } finally {
    savingAnime.value = false;
  }
}

/**
 * [U3-P4c/K15] 保存特效三档：**一次** PUT /admin/config/effects 提交三域（域内按提交键
 * 逐属性写回；某域不可得则该域不提交——整域缺省 = 还原该域主题默认）。
 * 顺序：JSON 兜底字段解析 → 三域合成 → `SiteEffectsSchema` 本地整档校验 → 发请求。
 * 为什么必须三域一起提交：服务端把 `siteEffects` override **整档重写**，只提交一域会
 * 丢掉其它两域的 override 记录（config.ts 现值仍在，但面板回显会错位）。
 */
async function onSaveEffects(value: Record<string, unknown>): Promise<void> {
  const payload: Record<string, Record<string, unknown>> = {};
  for (const domain of SITE_EFFECTS_KEYS) {
    if (effectsUnavailable.value[domain]) {
      // 该域基线/覆盖均不可得：不提交（服务端会对缺失声明 404 并整体零物化）
      continue;
    }
    const formDomain = value[domain];
    const domainValue: Record<string, unknown> =
      typeof formDomain === 'object' && formDomain !== null ? { ...formDomain } : {};
    // 未回填的可选键保持 undefined：剔除，避免把 undefined 写进 JSON body
    for (const [key, fieldValue] of Object.entries(domainValue)) {
      if (fieldValue === undefined) {
        delete domainValue[key];
      }
    }
    // 结构化键：空串 = 不提交该键（保留 config.ts 现值）；非空必须是 JSON 对象
    for (const key of EFFECTS_JSON_KEYS[domain]) {
      const text = (effectsJson.value[`${domain}.${key}`] ?? '').trim();
      if (text === '') {
        continue;
      }
      const parsed = parseJsonObject(text);
      if (parsed === null) {
        ElMessage.warning(`${domain}.${key} 须为 JSON 对象（如 { "min": 0, "max": 1 }）`);
        return;
      }
      domainValue[key] = parsed;
    }
    payload[domain] = domainValue;
  }
  if (Object.keys(payload).length === 0) {
    ElMessage.warning('特效三档均不可得（主题声明缺失或形态不符），无法保存');
    return;
  }
  const parsed = SiteEffectsSchema.safeParse(payload);
  if (!parsed.success) {
    ElMessage.warning(`特效配置校验未通过：${firstIssueOf(parsed.error)}`);
    return;
  }
  savingEffects.value = true;
  try {
    await configApi.putEffects(parsed.data as Record<string, Record<string, unknown>>);
    ElMessage.success('特效配置已保存；如需反映到站点请在「构建预览」执行 build');
    await fetchConfig();
  } catch (e) {
    notifyApiError(e, '保存特效配置失败');
  } finally {
    savingEffects.value = false;
  }
}

onMounted(() => {
  void fetchConfig();
});</script>

<template>
  <div v-loading="loading" class="site-config-page panel-card">
    <div class="page-header">
      <h2 class="page-title">站点配置</h2>
      <span class="page-subtitle">Astro 博客受控配置管理</span>
    </div>
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="受控子集：站点信息 / 番剧与 B 站 / 特效 / 评论 / 导航 / 个人资料 / 公告"
      description="仅管理主题 config.ts 的 siteConfig（含 15 个站点信息键与 anime / bangumi / bilibili 三键）、musicPlayerConfig / sakuraConfig / pioConfig 三个特效声明、commentConfig、navBarConfig、profileConfig、announcementConfig，其余字段不受影响；配置值均为公开性质（随构建烘入站点前端，无敏感键；meting_api 除外，它不在面板管理面）。番剧与 B 站三域按域整对象替换（面板全字段回填后提交）。保存后请在「构建预览」执行 build 任务使站点生效。"
      class="page-alert"
    />

    <!-- [U3-P1/K8] 五区折叠：站点信息 / 评论 / 导航 / 个人资料 / 公告（无新路由、无新菜单） -->
    <el-collapse v-model="activeSections" class="config-collapse">
      <!-- ① 站点信息：siteConfig 15 受管键（13 表单键 + banner/font JSON） -->
      <el-collapse-item name="site-info" title="站点信息">
        <el-alert
          v-if="siteInfoUnavailable"
          type="warning"
          :closable="false"
          show-icon
          title="站点信息基线不可得"
          description="主题 config.ts 的 siteConfig 声明不是对象字面量（缺声明/含未支持的写法），基线无法解析为可编辑数据；表单以空值起步，且写入门禁会先拒绝（探针失败 409）。请先修复主题声明形态。"
          class="page-alert"
        />
        <div class="nav-help">
          <code>banner</code>（轮播图）与 <code>font</code>（两档字体）形态复杂——banner.src 支持
          单串 / 串数组 / 桌面-移动分档对象，故以 JSON 编辑；其余 13 键用下方表单。
          保存时两段 JSON 与表单值合并后整体过一遍 schema 校验，未通过不发请求。
        </div>
        <el-form label-width="140px">
          <el-form-item label="banner（JSON）">
            <el-input
              v-model="siteBannerJson"
              type="textarea"
              :rows="10"
              spellcheck="false"
              class="nav-textarea"
              aria-label="banner JSON"
            />
          </el-form-item>
          <el-form-item label="font（JSON）">
            <el-input
              v-model="siteFontJson"
              type="textarea"
              :rows="8"
              spellcheck="false"
              class="nav-textarea"
              aria-label="font JSON"
            />
          </el-form-item>
        </el-form>
        <SchemaForm
          :schema="SITE_INFO_FORM_SCHEMA"
          :model-value="siteFormValue"
          :labels="CONFIG_LABELS"
          :loading="savingSite"
          submit-label="保存站点信息"
          @update:model-value="(v: Record<string, unknown>) => (siteFormValue = v)"
          @submit="onSaveSiteInfo"
          @cancel="fetchConfig"
        />
        <el-collapse class="nav-baseline">
          <el-collapse-item title="主题基线站点信息（基线对照，只读）">
            <pre class="nav-baseline-pre">{{ baselineSiteInfoText ?? '基线不可得' }}</pre>
          </el-collapse-item>
        </el-collapse>
      </el-collapse-item>

      <!-- [U3-P4a/K8] 番剧与 B 站：siteConfig 的 anime / bangumi / bilibili 三键（默认收起） -->
      <el-collapse-item name="anime" title="番剧与 B 站">
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="按域整对象替换：未在表单出现的子键会被移除"
          description="保存时三域各自整体替换 config.ts 中的对应对象（服务端不做键级合并），故表单已把基线/覆盖值全字段回填；清空某个子键即等于从站点配置里移除它。越界键与非法枚举由服务端 .strict() 拒绝（400）。保存后需跑一次 build 才在站点生效。"
          class="page-alert"
        />
        <SchemaForm
          :schema="ANIME_FORM_SCHEMA"
          :model-value="animeFormValue"
          :labels="ANIME_LABELS"
          :loading="savingAnime"
          submit-label="保存番剧与 B 站配置"
          @update:model-value="(v: Record<string, unknown>) => (animeFormValue = v)"
          @submit="onSaveAnime"
          @cancel="fetchConfig"
        />
      </el-collapse-item>

      <!-- [U3-P4c/K15] 特效：config.ts 三个顶层声明（musicPlayerConfig / sakuraConfig / pioConfig），默认收起 -->
      <el-collapse-item name="effects" title="特效">
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="逐属性置换：只覆盖本页提交的字段，未提交的子键保持 config.ts 现值"
          description="三域分别物化 config.ts 的顶层声明 musicPlayerConfig / sakuraConfig / pioConfig（widgetConfigs 里的成员只是标识符引用，不碰）。本页已把基线/覆盖值全字段回填后整域提交，故正常保存不会丢键；清空某个子键 = 该键不再出现在提交里（服务端按提交的键逐属性写回，未提交的键保持 config.ts 现值），整域不提交 = 还原该域主题默认。meting_api 含凭据，不在面板管理，请手改 src/config.ts。保存后需跑一次 build 才在站点生效。"
          class="page-alert"
        />
        <el-alert
          v-for="domain in SITE_EFFECTS_KEYS"
          v-show="effectsUnavailable[domain]"
          :key="`unavailable-${domain}`"
          type="warning"
          :closable="false"
          show-icon
          :title="`${domain} 基线不可得`"
          description="该域既无 override 也无基线（声明缺失或初始化器不是对象字面量），不可编辑且本次不提交；请先修复主题 config.ts 的声明形态。"
          class="page-alert"
        />
        <div class="nav-help">
          结构化子键（<code>sakura.size</code> / <code>sakura.opacity</code> /
          <code>sakura.speed</code> / <code>pio.dialog</code>）在主题里是嵌套对象或联合/元组形态，
          服务端按**整值**置换（不递归下钻），故以 JSON 编辑；留空 = 本次不提交该键。
        </div>
        <el-form label-width="140px">
          <el-form-item v-for="field in EFFECTS_JSON_FIELDS" :key="field.path" :label="field.label">
            <el-input
              :model-value="effectsJson[field.path] ?? ''"
              type="textarea"
              :rows="6"
              spellcheck="false"
              class="nav-textarea"
              :aria-label="`${field.label} JSON`"
              @update:model-value="(text: string) => setEffectsJson(field.path, text)"
            />
          </el-form-item>
        </el-form>
        <SchemaForm
          :schema="EFFECTS_FORM_SCHEMA"
          :model-value="effectsFormValue"
          :labels="EFFECTS_LABELS"
          :loading="savingEffects"
          submit-label="保存特效配置"
          @update:model-value="(v: Record<string, unknown>) => (effectsFormValue = v)"
          @submit="onSaveEffects"
          @cancel="fetchConfig"
        />
      </el-collapse-item>

      <!-- ② 评论（现状不动：站点语言 + commentConfig 同存） -->
      <el-collapse-item name="comments" title="评论">        <el-form label-width="140px" class="lang-form">
          <el-form-item label="语言">
            <!-- [Phase4-D4/配套2] el-select（allow-create + filterable + clearable）：
                 选项 = 主题实测支持集；自行输入保留（schema 双兼容为权威）；清空 = 站点默认 -->
            <el-select
              v-model="lang"
              placeholder="en"
              allow-create
              filterable
              default-first-option
              clearable
              class="lang-input"
              @clear="lang = ''"
            >
              <el-option v-for="code in langOptions" :key="code" :label="code" :value="code" />
            </el-select>
            <div class="field-help">
              可选；空 = 站点默认（当前基线：{{ baselineLang ?? '未知' }}），可从常用语言选择或自行输入（连字符/下划线分段由服务端校验）
            </div>
          </el-form-item>
        </el-form>
        <el-alert
          v-if="baselineUnavailable"
          type="warning"
          :closable="false"
          show-icon
          title="评论配置基线不可得"
          description="主题 config.ts 缺 commentConfig 声明或含未支持的写法，表单以空值起步；填写全量字段保存后即由面板接管。"
          class="page-alert"
        />
        <SchemaForm
          :schema="CommentConfigSchema as ZodObject<Record<string, ZodType>>"
          :model-value="formValue"
          :labels="CONFIG_LABELS"
          :loading="saving"
          submit-label="保存站点配置"
          @update:model-value="(v: Record<string, unknown>) => (formValue = v)"
          @submit="onSubmit"
          @cancel="fetchConfig"
        />
      </el-collapse-item>

      <!-- ③ 导航（现状不动；仍保「还原主题默认」通道） -->
      <el-collapse-item name="nav" title="导航">
        <!-- [Phase4-D3] 导航管理区（#8；JSON textarea 兜底，C2b links 先例同构） -->
        <el-alert
          v-if="navBaselineUnavailable"
          type="warning"
          :closable="false"
          show-icon
          title="导航基线不可得"
          description="主题 config.ts 的 navBarConfig 含预设标识符（LinkPreset）等未支持写法，基线无法解析为可编辑数据；编辑器以空表单起步，首次保存即由面板接管（保存前原文已留档，可随时还原）。"
          class="page-alert"
        />
        <div class="nav-help">
          以 JSON 数组编辑导航项：每项含 <code>name</code>（必填，≤64 字）、<code>url</code>（必填，≤512
          字符，仅支持 http/https、/ 开头站内路径、#）；可选 <code>icon</code>（iconify 标识符，≤128）、
          <code>external</code>（布尔）、<code>children</code>（子菜单，最多一层）。
        </div>
        <el-input
          v-model="navJson"
          type="textarea"
          :rows="14"
          spellcheck="false"
          class="nav-textarea"
          aria-label="导航 JSON"
        />
        <div class="nav-actions">
          <el-button type="primary" :loading="saving" class="btn-gradient-primary" @click="onSaveNav">保存导航</el-button>
          <el-button :loading="saving" @click="onResetNav">还原主题默认</el-button>
        </div>
        <el-collapse v-if="baselineNavText || baselineNavRaw" class="nav-baseline">
          <el-collapse-item
            v-if="baselineNavText"
            title="主题默认导航（基线对照，只读）"
          >
            <pre class="nav-baseline-pre">{{ baselineNavText }}</pre>
          </el-collapse-item>
          <!-- [U3-P2/K6] 解析失败时的原文对照：LinkPreset 预设原样可见，用户不至蒙眼接管 -->
          <el-collapse-item
            v-else
            title="主题默认导航（原文对照，含 LinkPreset 预设，只读）"
          >
            <pre class="nav-baseline-pre">{{ baselineNavRaw }}</pre>
          </el-collapse-item>
        </el-collapse>
      </el-collapse-item>

      <!-- ④ 个人资料：profileConfig（links 由 mapper 既有 json widget 承载） -->
      <el-collapse-item name="profile" title="个人资料">
        <el-alert
          v-if="profileUnavailable"
          type="warning"
          :closable="false"
          show-icon
          title="个人资料基线不可得"
          description="主题 config.ts 缺 profileConfig 声明或含未支持的写法，表单以空值起步；填写全量字段保存后即由面板接管。"
          class="page-alert"
        />
        <SchemaForm
          :schema="ProfileConfigSchema as ZodObject<Record<string, ZodType>>"
          :model-value="profileFormValue"
          :labels="CONFIG_LABELS"
          :loading="savingProfile"
          submit-label="保存个人资料"
          @update:model-value="(v: Record<string, unknown>) => (profileFormValue = v)"
          @submit="onSaveProfile"
          @cancel="fetchConfig"
        />
      </el-collapse-item>

      <!-- ⑤ 公告：announcementConfig（content 非空必填） -->
      <el-collapse-item name="announcement" title="公告">
        <el-alert
          v-if="announcementUnavailable"
          type="warning"
          :closable="false"
          show-icon
          title="公告基线不可得"
          description="主题 config.ts 缺 announcementConfig 声明或含未支持的写法，表单以空值起步；填写全量字段保存后即由面板接管。"
          class="page-alert"
        />
        <SchemaForm
          :schema="AnnouncementConfigSchema as ZodObject<Record<string, ZodType>>"
          :model-value="announcementFormValue"
          :labels="CONFIG_LABELS"
          :loading="savingAnnouncement"
          submit-label="保存公告"
          @update:model-value="(v: Record<string, unknown>) => (announcementFormValue = v)"
          @submit="onSaveAnnouncement"
          @cancel="fetchConfig"
        />
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<style scoped>
.page-header {
  margin-bottom: 16px;
}
.page-title {
  font-size: 20px;
  font-weight: 700;
  margin: 0 0 4px;
  color: var(--el-text-color-primary);
}
.page-subtitle {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.page-alert {
  margin-bottom: 16px;
  border-radius: var(--mizuki-radius-control);
}
.lang-form {
  margin-bottom: 8px;
}
/* [U3-P1/K8] 五区折叠容器（间距走既有 token，无新增色值/圆角/阴影） */
.config-collapse {
  margin-top: 4px;
  border-top: none;
}
.lang-input {
  max-width: 240px;
}
.field-help {
  width: 100%;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
.nav-help {
  margin-bottom: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
.nav-help code {
  padding: 0 4px;
  border-radius: var(--el-border-radius-small);
  background: var(--el-fill-color-light);
}
.nav-textarea {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}
.nav-actions {
  margin-top: 8px;
}
.nav-baseline {
  margin-top: 12px;
}
.nav-baseline-pre {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
