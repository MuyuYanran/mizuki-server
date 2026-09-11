/**
 * [Phase4-E3a] 主题档案 schema + Mizuki Tier 1 内置档案（theme-lock 机制，ADR-024）
 * [职责] 把散落各批的主题结构隐式假设升格为一等机制——可机检的身份、指纹、
 *   形状档案。两轴正交：
 *   - 漂移轴（相对上次基线快照，诊断用，re-capture 可重置）；
 *   - 探针轴（相对档案内置预期，执法用，re-capture 不可重置——洗白防护）。
 * [载体] canonical = 本文件 MizukiTier1Profile（typed 常量，T3 Registry 与 T4 门禁
 *   运行期 import）；docs/profiles/mizuki-tier1.md 为派生人文档（禁手改）。
 * [状态] ACTIVE
 *
 * 声明探针三钉（T1.3 定形）：
 *   ① 参照源 = 档案内置预期（本文件 declarationProbes），禁取运行基线快照；
 *   ② 同一性：探针目标 = 物化实现实际写入节点（site-config.service 三写入器
 *     canonical 符号：siteConfig / siteConfig.lang / commentConfig /
 *     navBarConfig / navBarConfig.links）；
 *   ③ 形态匹配级别 = 结构性形态匹配（存在 + 对象形态 + 键面过 schema），
 *     原始态与物化态均须通过，禁写特定配置值为预期（v2.2 裁决）。
 */
import { z } from 'zod';

/** 指纹条目角色（T1.2 编目来源四类） */
export const FINGERPRINT_ROLES = [
  'materialization-carrier', // (a) 物化链声明载体（config.ts）
  'identity', // (b) 身份文件（package.json / astro.config.mjs）
  'structure-assumption', // (c) 目录级结构假设（public/ / dist/ / src/content/posts/，不指纹）
  'token-source', // (d) ADR-023 token 提取实际读取的样式文件
] as const;

/** 档案指纹种子条目（采集时点编目记录；sha256 = null 表示目录级假设不指纹） */
export const FingerprintEntrySchema = z
  .object({
    /** 相对 mizukiRoot 的路径（POSIX 形；目录级条目以 / 结尾） */
    path: z.string().min(1),
    role: z.enum(FINGERPRINT_ROLES),
    sha256: z.string().nullable(),
    /** 采集注记（如物化态定性、裁决锚出处） */
    note: z.string().optional(),
  })
  .strict();

/** 声明探针形态检查级别（结构性匹配，由写入器前置要求决定） */
export const PROBE_CHECKS = [
  'declaration-exists', // 顶层声明存在（siteConfig / commentConfig / navBarConfig）
  'initializer-object', // 初始化器为对象字面量（as/satisfies/括号解包后）
  'property-exists', // 一级属性存在（property 生效时）
  'property-assignment', // 该属性为 PropertyAssignment（值形态不校验——标识符/字面量均过）
  'property-array-literal', // 该属性值为数组字面量（嵌套形状，元素值不校验）
  'value-parses-schema', // 常量代入求值成功且键面过受控 schema（commentConfig 专用）
] as const;

/** 声明探针预期（档案内置；target = canonical 符号，可含一级属性路径） */
export const DeclarationProbeSpecSchema = z
  .object({
    target: z.string().min(1),
    checks: z.array(z.enum(PROBE_CHECKS)).min(1),
    /** property-exists / property-assignment / property-array-literal 生效时的属性名 */
    property: z.string().min(1).optional(),
  })
  .strict();

/** 探针运行结果 */
export const ProbeResultSchema = z
  .object({
    target: z.string(),
    passed: z.boolean(),
    /** 失败明细（passed=false 时非空；通过时为「通过」） */
    detail: z.string(),
  })
  .strict();

/** 主题档案（版本化；Profile schema 可承载多主题，E3a 实现只做 Mizuki 一档） */
export const ThemeProfileSchema = z
  .object({
    /** 档案自身版本（与主题版本无关；档案结构/预期变更时递增） */
    profileVersion: z.string().min(1),
    themeKey: z.string().min(1),
    identity: z
      .object({
        name: z.string().nullable(),
        version: z.string().nullable(),
        /** 采集日期（YYYY-MM-DD，执行日实测，本地时区） */
        collectedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        note: z.string().optional(),
      })
      .strict(),
    fingerprintSeeds: z.array(FingerprintEntrySchema).min(1),
    declarationProbes: z.array(DeclarationProbeSpecSchema).min(1),
    /** 形状注记（人文说明，非机检） */
    shapeNotes: z.array(z.string()),
    /** token 策展节（ADR-023 表转录；策展静态档案，禁运行期 styl 解析——T1.6 决策） */
    tokenCuration: z.array(z.string()).optional(),
    /**
     * i18n 支持集策展（Phase4-D4 T1.3 主题根只读实测；静态策展档案，禁运行期主题文件解析）
     * 值域 = 实测支持集，禁臆造；承载 A3（文章链）与 A4（站点链）两条 lang 链的形态分歧依据。
     */
    i18nSupport: z
      .object({
        /** 实装译文包（src/i18n/languages/ 导出文件，去扩展名） */
        translationPacks: z.array(z.string()).min(1),
        /** getTranslation 接受键集（translation.ts map 键，小写下划线形态） */
        acceptedKeys: z.array(z.string()).min(1),
        /** siteConfig.lang 官方类型联合（src/types/config.ts lang 字段） */
        siteLangUnion: z.array(z.string()).min(1),
        /** 站点链（A4）形态约定 */
        siteLangForm: z.string().min(1),
        /** 文章链（A3）形态约定（content.config.ts：lang 为自由字符串，无枚举约束） */
        postLangForm: z.string().min(1),
      })
      .strict()
      .optional(),
    knownLimitations: z.array(z.string()),
  })
  .strict();

/** 基线文件（capture 产物；profileVersion 失配 → 拒绝加载 + 重捕获指引，R3 分派表失配态） */
export const ThemeBaselineFileSchema = z
  .object({
    profileVersion: z.string().min(1),
    /** 捕获时刻（ISO 8601） */
    capturedAt: z.string().min(1),
    /** 编目全量条目（present 显式记录——目录级存在性漂移可检） */
    entries: z
      .array(
        z
          .object({
            path: z.string().min(1),
            present: z.boolean(),
            sha256: z.string().nullable(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

/** 漂移项（声明级缺失归探针轴，不混入漂移轴） */
export const ThemeDriftItemSchema = z
  .object({
    path: z.string(),
    kind: z.enum(['added', 'removed', 'modified']),
  })
  .strict();

/** GET /admin/theme/status 响应视图（身份 + 指纹时间戳 + 漂移三态 + 探针结果） */
export const ThemeStatusViewSchema = z
  .object({
    identity: z
      .object({
        name: z.string().nullable(),
        version: z.string().nullable(),
        /** 身份源：package.json（name+version 双全）或 fingerprint（降级：指纹代身份） */
        fallback: z.enum(['package.json', 'fingerprint']),
      })
      .strict(),
    fingerprint: z
      .object({
        scannedAt: z.string(),
        digest: z.string(),
        entries: z
          .array(
            z
              .object({
                path: z.string(),
                role: z.enum(FINGERPRINT_ROLES),
                present: z.boolean(),
                sha256: z.string().nullable(),
              })
              .strict(),
          )
          .min(1),
      })
      .strict(),
    baseline: z
      .object({
        /** R3 分派表四态：absent（缺失，非错误）/ loaded（合法）/ version-mismatch（失配）/ parse-error（解析失败） */
        state: z.enum(['absent', 'loaded', 'version-mismatch', 'parse-error']),
        profileVersion: z.string().nullable(),
        capturedAt: z.string().nullable(),
        detail: z.string().nullable(),
      })
      .strict(),
    drift: z
      .object({
        state: z.enum(['no-baseline', 'clean', 'drifted']),
        items: z.array(ThemeDriftItemSchema),
      })
      .strict(),
    probes: z.array(ProbeResultSchema),
  })
  .strict();

export type FingerprintEntry = z.infer<typeof FingerprintEntrySchema>;
export type DeclarationProbeSpec = z.infer<typeof DeclarationProbeSpecSchema>;
export type ProbeResult = z.infer<typeof ProbeResultSchema>;
export type ThemeProfile = z.infer<typeof ThemeProfileSchema>;
export type ThemeBaselineFile = z.infer<typeof ThemeBaselineFileSchema>;
export type ThemeDriftItem = z.infer<typeof ThemeDriftItemSchema>;
export type ThemeStatusView = z.infer<typeof ThemeStatusViewSchema>;

/**
 * Mizuki Tier 1 档案（真实主题实测采集，2026-09-02）。
 * 指纹种子哈希为采集时点实测（v2.2 裁决锚：config.ts 含走查期 commentConfig
 * 物化态 = 用户真实站点配置，管理权转移，ADR-020 设计行为）。
 * [v2.3 重锚 2026-09-08] src/config.ts 种子更新（provenance = 用户域形态分歧 +
 * 日期）：D4c 批首实测 config.ts sha256 = 5C889C60…（mtime 2026-09-04，本轮工作
 * 开始前已变更）——siteConfig 声明带 `: SiteConfig` 类型注解、lang 为字面量
 * "zh_CN"（v2.2 锚记的 SITE_LANG 标识符引用态已不在位）。C9ECC6EF… 作废归档。
 * 重锚与 drift 轴关系：drift 比对参照 = capture 产物基线（baseline.entries，
 * capturedAt = 捕获当下），**非**档案种子；种子仅承担批首/批末审计双锚。
 * profileVersion 仍为 '1'（种子值变更不触发基线失配重捕获口径）。
 */
export const MizukiTier1Profile: ThemeProfile = {
  profileVersion: '1',
  themeKey: 'mizuki',
  identity: {
    name: 'mizuki',
    version: '9.0',
    collectedAt: '2026-09-02',
    note: 'version 形态为 "9.0"（字符串，非 semver 三段式）；package.json 无 version 字段时身份降级为指纹代身份',
  },
  fingerprintSeeds: [
    {
      path: 'src/config.ts',
      role: 'materialization-carrier',
      sha256: '5C889C601F9480EEFF4A1D76A4F19BB972F9BB0E6D0D04F3A95AF1407B41D7FE',
      note: 'v2.3 重锚（2026-09-08，provenance = 用户域形态分歧 + 日期）：siteConfig 带类型注解、lang 字面量 "zh_CN"；C9ECC6EF…（v2.2 裁决锚，SITE_LANG 标识符态）作废归档',
    },
    { path: 'package.json', role: 'identity', sha256: 'AC1C6B6C9793A43025EDCDBD5FDFAABB7D20955A694815D372D927124B42F6DB' },
    { path: 'astro.config.mjs', role: 'identity', sha256: '499D8D198767B1F716AD06276DEB6F7DBC449059D6168FA5BBBA0582B4BB308C' },
    { path: 'public/', role: 'structure-assumption', sha256: null, note: 'site-assets 挂载前提（目录存在性假设，用户资产域不指纹）' },
    { path: 'dist/', role: 'structure-assumption', sha256: null, note: 'preview 服务目标（Astro 默认 outDir，构建产物域不指纹）' },
    { path: 'src/content/posts/', role: 'structure-assumption', sha256: null, note: 'content-posts 预览出口映射目标（用户内容域不指纹）' },
    { path: 'src/styles/main.css', role: 'token-source', sha256: '50D8E00D0AF76BEF9F7BE9F6DD716938B4224418F616F51D77E6A9BE64CEDF64', note: 'ADR-023 token 使用点（派生档 calc(var(--radius-large)-0.5rem) @ L454）' },
    { path: 'src/styles/variables.styl', role: 'token-source', sha256: '47120D92371CC42C2DC3BB91350E797FEA8E2E6224E1C24929F26A20AF9FED79', note: 'ADR-023 token 定义点（:root --radius-large 1rem @ L12）' },
  ],
  declarationProbes: [
    { target: 'siteConfig', checks: ['declaration-exists', 'initializer-object'] },
    { target: 'siteConfig.lang', property: 'lang', checks: ['property-exists', 'property-assignment'] },
    { target: 'commentConfig', checks: ['declaration-exists', 'initializer-object', 'value-parses-schema'] },
    { target: 'navBarConfig', checks: ['declaration-exists', 'initializer-object'] },
    { target: 'navBarConfig.links', property: 'links', checks: ['property-exists', 'property-array-literal'] },
  ],
  shapeNotes: [
    'navBarConfig.links：LinkPreset 标识符引用（PropertyAccess 节点）+ 对象数组混排 + children 嵌套一层（孙级 400 拒绝，D3 受控子集值域）——navbar children 深度 = 1（D3 遗留闭环，官方示例实测同深度）',
    'icon 为 iconify 字符串字面量（如 material-symbols:link），非组件引用（D3 受控子集纳入依据）',
    'SITE_LANG / SITE_TIMEZONE 为顶层非导出简单常量（const 字面量），siteConfig.lang 以标识符引用（SITE_LANG）——常量表代入可求值',
    'siteConfig 对象含引号键段（"title"/"navbarTitle"）与裸键混合形态',
    'siteConfig.lang = SITE_LANG 标识符还原态（originals.siteConfig.lang 留档在 override 侧车，ADR-020）；commentConfig 为已物化态（用户真实站点配置，管理权转移，ADR-020 设计行为）',
    'i18n 双链形态分歧（T1.3 主题根只读实测）：站点链（A4，siteConfig.lang）用下划线 zh_CN，getTranslation 仅 toLowerCase 后匹配 translation.ts map，无 "-→_" 归一 → 连字符写法 zh-CN 落 zh-cn 未命中，静默回退默认译文 en（translation.ts:24 `map[lang.toLowerCase()] || defaultTranslation`）；文章链（A3，posts frontmatter lang）为 content.config.ts:16 自由字符串无枚举约束，官方 README 示例为 BCP-47 连字符 zh-CN，页面侧以 siteConfig.lang.replace("_","-") 兜底（[...slug].astro:184 / [...permalink].astro:108）——A3/A4 两条独立 lang 链的分离性实测依据',
  ],
  tokenCuration: [
    '--radius-large = 1rem（variables.styl:12）→ --mizuki-radius-card（卡片档）',
    'calc(var(--radius-large)-0.5rem) = 8px（main.css:454）→ --mizuki-radius-control（控件档）',
    'pill 档主题无对应 → 惯例 999px（--mizuki-radius-pill，偏差登记 ADR-023）',
    '--card-bg（white / oklch 双态）→ --el-bg-color（Element Plus 自带双态，卡片底色）',
    '--page-bg（oklch 亮暗双态）→ --mizuki-body-bg（亮 #f5f7fa / 暗 #0a0a0a，近似 hex 偏差登记 ADR-023）',
    'shadow-xl（Tailwind utility）→ --mizuki-card-shadow: 0 4px 18px rgba(232,115,158,.1)',
    '--primary oklch(0.70 0.14 var(--hue)) → 既有 --mizuki-accent（主色映射不扩）',
    '策展口径：token 策展为静态档案（ADR-023 表转录），禁运行期 styl 解析（E3a T1.6 决策）',
  ],
  i18nSupport: {
    translationPacks: ['en', 'ja', 'zh_CN', 'zh_TW'],
    acceptedKeys: ['en', 'en_us', 'en_gb', 'en_au', 'zh_cn', 'zh_tw', 'ja', 'ja_jp'],
    siteLangUnion: ['en', 'zh_CN', 'zh_TW', 'ja', 'ko', 'es', 'th', 'vi', 'tr', 'id'],
    siteLangForm: '下划线（zh_CN）',
    postLangForm: 'BCP-47 连字符（zh-CN）',
  },
  knownLimitations: [
    '编目为固定路径清单：主题升级新增文件不可检出（盲区）——升级走查须人工核对（ADR-024 已知限制）',
    'originals 留档仅覆盖受控声明（siteConfig.lang / navBarConfig）：非 config.ts 文件无历史锚残余，手工改动的还原依赖留档存在性',
    '基线存于 apps/server/data/theme-baseline/（本地可篡改）——admin 域内可接受（信任边界 = 管理员）',
    '全树清单与漂移比对排除 node_modules/.astro/dist：依赖域与构建产物域不属主题源资产',
    'siteConfig.lang 官方类型联合含 ko/es/th/vi/tr/id 六值（src/types/config.ts:48-53），但 translation.ts map 无对应条目 → 合法配置但无译文，静默回退 en（主题既有设计，非本批缺陷）；date-utils localeMap（14 值，含 fr/de/ru/ar）与 language-utils 显示名表（15 组 + 翻译服务格式 11 组）覆盖面更广，与 i18n 包非同一集合',
    'i18n 支持集为真实 Tier1 主题根实测值（Mizuki v9.0）；e2e fixture 主题树（apps/server/test/fixtures/mizuki，mizuki-fixture v1.0.0）为最小桩，无 src/i18n 与 src/config.ts，不复制本策展节',
  ],
};
