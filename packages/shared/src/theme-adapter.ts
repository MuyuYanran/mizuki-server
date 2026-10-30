/**
 * [T1] theme-adapter — 主题适配层契约：识别 mizuki / shirone 并回传能力画像
 * [职责] 把「本服务只懂 Mizuki 一种主题」的隐式假设升格为可机检的两档适配契约：
 *   - 身份判定：kind ∈ mizuki / shirone / unknown（判据由 T2 探测实现单源持有）；
 *   - 形状投影：layout（root 为绝对路径，**仅供后端内部使用**，禁进任何 HTTP 响应）；
 *   - 能力画像：config / dataFiles / posts / contentCollections / themeLock / serverMode 六组，
 *     说明该主题「本服务能改什么、用什么策略改」；
 *     serverMode 组与主题无关（是 Kova 自身运行模式的只读透传），故三档（含 unknown）均回传。
 *   - **T3a 三档形态**：kind 仍是 mizuki / shirone / unknown 三值（不新增 ThemeKind 取值），
 *     但 mizuki 有 **legacy（单文件 src/config.ts）/ HEAD（src/config/ 目录 + overrides 侧车）**
 *     两种共存的形态，二者由 `layout.configDir`/`configFile` 与 `capabilities.config.strategy`
 *     区分（集合表等其余能力面在两种 mizuki 形态下完全相同）；配置策略枚举故有四值。
 *     `capabilities.config.domains` = 本档「可写配置名」名单（legacy 留空，另受 site-config 契约约束）。
 * [载体] 本文件是主题能力面的单源（typed 常量由 server 侧 theme-adapter.service 消费）；
 *   HTTP 视图见 theme.controller 的 profile 端点（剔除 layout.root，仓规红线 6）。
 * [与 theme-profile.ts 的关系] 后者是 ADR-024 的主题档案 / 基线 / 漂移双轴机制（单档
 *   Mizuki Tier 1）；本文件是**多档识别 + 能力声明**面，两者正交、不互相 import。
 *   **命名避让**：theme-profile.ts 已导出 ThemeProfileSchema / ThemeProfile，本文件的
 *   档案 schema 故取 ThemeAdapterProfileSchema / ThemeAdapterProfile，避免 index.ts
 *   的两条 `export *` 撞名（TS2308）。见 theme-profile.ts §[Phase4-E3a]。
 * [状态] ACTIVE（T1：纯只读探测，零写盘面）
 */
import { z } from 'zod';

/** 主题种类：unknown = 两档判据均不成立（缺失 / 空 / 非法一律归此，R3 语义） */
export const ThemeKindSchema = z.enum(['mizuki', 'shirone', 'unknown']);

/** 主题形状投影（路径一律相对 root 的 POSIX 形态；根目录尚不存在时为 unknown 的形状） */
export const ThemeLayoutSchema = z
  .object({
    kind: ThemeKindSchema,
    /**
     * 主题根绝对路径。**仅后端内部使用**：禁进任何 HTTP 响应、禁进对外错误文案
     * （仓规红线 6）。面板视图由 controller 显式剔除本键。
     */
    root: z.string(),
    /** 站点配置所在目录（mizuki: src；shirone: src/config；unknown: 空串） */
    configDir: z.string(),
    /** 单文件配置（mizuki: src/config.ts；shirone 与 unknown: null） */
    configFile: z.string().nullable(),
    /** 集合数据目录（两档均为 src/data） */
    dataDir: z.string(),
    /** 内容根（两档均为 src/content） */
    contentDir: z.string(),
    /** 文章目录（两档均为 src/content/posts） */
    postsDir: z.string(),
    /** 静态公开资源根（两档均为 public） */
    publicDir: z.string(),
  })
  .strict();

/**
 * 配置写入策略（判定档 → 策略，一一对应）：
 *   - ts-morph-declaration = mizuki-legacy（6.1.2）：单文件 `src/config.ts` 的 AST 声明改写；
 *   - overlay-ts = mizuki HEAD（7.1.3）：`src/config/` 目录形态，写入侧车 `src/config/overrides/<覆盖名>.ts`；
 *   - overlay-yaml = shirone：内容仓侧车 `config/<域>.yaml`；
 *   - none = unknown（Q2：npm 包模式等不支持形态）。
 */
export const ThemeConfigStrategySchema = z.enum([
  'ts-morph-declaration',
  'overlay-ts',
  'overlay-yaml',
  'none',
]);

/**
 * 运行模式：对应 REQUIREMENTS §3 三模式（仅管理 / 新增文件 / 覆盖文件）。
 * 与 server 侧 AppConfigSchema.mode 取值同域，但**在本包独立声明**：
 * shared 不得依赖 server 侧实现（L0 分层）。
 */
export const ThemeModeSchema = z.enum(['manage', 'additive', 'overwrite']);

/** 主题能力画像（六组；supported=false 时对应数组为空、id 为空串） */
export const ThemeCapabilitiesSchema = z
  .object({
    config: z
      .object({
        supported: z.boolean(),
        strategy: ThemeConfigStrategySchema,
        /**
         * 本档「可写配置名」名单 —— 即该档下本服务**声明**可写的配置标识，不是「所有配置项」清单：
         *   - mizuki-legacy → `[]`：可写面无侧车概念，由既有 `site-config` 契约（受控子集）决定，
         *     **不在本字段声明**（避免两处真源）；
         *   - mizuki HEAD → `overrideLoader.OVERRIDABLE_CONFIGS` 的 18 个覆盖名（逐字、顺序照抄）；
         *     ⚠ 覆盖名 ≠ 源文件名（如 `sakuraConfig` 覆盖的是 `effectsConfig.ts`）；
         *   - shirone → 内容仓 32 个配置域 key（`scripts/content/config-domains.mjs` 的 CONFIG_DOMAINS）；
         *   - unknown → `[]`。
         * 本字段只做**声明**：本阶段不据此生成/解析任何写入目标。
         */
        domains: z.array(z.string()),
      })
      .strict(),
    dataFiles: z
      .object({
        supported: z.boolean(),
        /** 可纳管的集合名（与 data-files 注册表的 collections 键同名） */
        collections: z.array(z.string()),
      })
      .strict(),
    posts: z
      .object({
        supported: z.boolean(),
        /** 可纳管的文章扩展名（含点，小写） */
        extensions: z.array(z.string()),
        /** frontmatter schema 标识（能力面命名，非 Zod schema 名） */
        frontmatterSchemaId: z.string(),
      })
      .strict(),
    contentCollections: z
      .object({
        supported: z.boolean(),
        /** 主题自带的内容集合 id（mizuki 无此形态） */
        ids: z.array(z.string()),
      })
      .strict(),
    themeLock: z
      .object({
        supported: z.boolean(),
        /** ADR-024 档案 id（无档主题为空串） */
        profileId: z.string(),
      })
      .strict(),
    serverMode: z
      .object({
        mode: ThemeModeSchema,
        /** 声明态：当前服务端对 mode 零行为分支（审计结论）；将来真落地强制再改 'enforced' */
        enforcement: z.enum(['declared-only', 'enforced']),
      })
      .strict(),
  })
  .strict();

/** 单步探测证据（name 为判据名；detail 只写相对路径，禁绝对路径） */
export const ThemeProbeEvidenceSchema = z
  .object({
    name: z.string().min(1),
    passed: z.boolean(),
    detail: z.string(),
  })
  .strict();

/** 主题适配档案：身份 + 形状 + 能力 + 探测证据链（证据全量保留，便于面板呈现判定过程） */
export const ThemeAdapterProfileSchema = z
  .object({
    kind: ThemeKindSchema,
    layout: ThemeLayoutSchema,
    capabilities: ThemeCapabilitiesSchema,
    evidence: z.array(ThemeProbeEvidenceSchema),
  })
  .strict();

export type ThemeKind = z.infer<typeof ThemeKindSchema>;
export type ThemeMode = z.infer<typeof ThemeModeSchema>;
export type ThemeLayout = z.infer<typeof ThemeLayoutSchema>;
export type ThemeConfigStrategy = z.infer<typeof ThemeConfigStrategySchema>;
export type ThemeCapabilities = z.infer<typeof ThemeCapabilitiesSchema>;
export type ThemeProbeEvidence = z.infer<typeof ThemeProbeEvidenceSchema>;
export type ThemeAdapterProfile = z.infer<typeof ThemeAdapterProfileSchema>;

/** 面板视图：剔除 layout.root（绝对路径不进响应体，仓规红线 6） */
export type ThemeAdapterProfileView = Omit<ThemeAdapterProfile, 'layout'> & {
  layout: Omit<ThemeLayout, 'root'>;
};
