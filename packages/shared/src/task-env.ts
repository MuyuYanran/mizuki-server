/**
 * [U3-P4a/K1/K3] shared/task-env — 任务级环境变量（config.json `taskEnv`）单源
 * [职责] 把「注入白名单任务子进程的环境变量」这一概念的**约束与对外视图**放在
 *   L0（packages/shared），使两处消费方共用同一份口径：
 *   ① apps/server/src/config/app-config.ts（AppConfigSchema 内嵌，落盘校验）；
 *   ② apps/server/src/modules/process（childEnv 注入 + admin/process/task-env 端点）。
 * [状态] ACTIVE
 *
 * 再裁 A（U3-P4a §0）：`taskEnv` 是**配置根级**键，不进 `tasks[]` 模板——
 *   模板是「一次点击的命名预设」，而 BILI_SESSDATA 这类值是任务运行期环境，
 *   对同类任务恒生效；挂模板会造成「同名任务换模板就丢凭据」的随机行为。
 *
 * 再裁 B（写后不可读）：值按 secret 处理——对外只给 `{ key, masked }`，明文永不回显；
 *   PUT 为整表替换语义（面板增/删/改后整表提交）。
 *
 * 纪律：本文件只放常量、schema 与纯函数（与 shared 其余文件同规），不引入任何 IO。
 */
import { z } from 'zod';

/**
 * [K1 ①] 键名前缀白名单（逐字）。校验时**不区分大小写**地比对前缀，
 * 但键名本身必须是**大写形态**（`BILI_SESSDATA` 合法，`bili_sessdata` 拒绝）。
 * 理由：主题侧消费端按大写键名读取（`process.env.BILI_SESSDATA`），
 * 允许小写会造出「配置写进去了但主题永远读不到」的静默失效。
 */
export const TASK_ENV_ALLOWED_PREFIXES = ['BILI_', 'ANIME_', 'ENABLE_', 'CONTENT_'] as const;

/**
 * [K1 ②] 禁止覆盖的安全键：与 `childEnv()` 的透传/恒写集合逐字一致。
 * 允许面板改写 PATH/APPDATA 等于把子进程的解析链交给配置；CI 是恒定常量
 * （Phase4-D4 配套1 的泄漏防线），二者都不允许被 taskEnv 覆盖。
 */
export const TASK_ENV_FORBIDDEN_KEYS = ['PATH', 'HOME', 'APPDATA', 'CI'] as const;

/** [K1 ③] 上限：键数 ≤ 16 */
export const TASK_ENV_MAX_ENTRIES = 16;
/** [K1 ③] 上限：键名 ≤ 64 字符 */
export const TASK_ENV_MAX_KEY_LENGTH = 64;
/** [K1 ③] 上限：单值 ≤ 4096 字符 */
export const TASK_ENV_MAX_VALUE_LENGTH = 4096;

/**
 * [K3] 掩码规则：长度 ≥ 8 → `••••` + 末 4 字符；否则整体掩码 `••••`。
 * 末 4 字符的用途仅为「核对是哪一条」，不足以复原（B 站 cookie 长度数百字符）。
 */
export function maskTaskEnvValue(value: string): string {
  return value.length >= 8 ? `••••${value.slice(-4)}` : '••••';
}

/**
 * [K1] 三条硬约束的单源实现（config 落盘校验与 PUT 请求体校验共用，禁两处漂移）。
 * 错误信息只含**键名/上限**，绝不含值（K4：值不得进入异常 detail）。
 */
export const TaskEnvRecordSchema = z
  .record(z.string().max(TASK_ENV_MAX_KEY_LENGTH), z.string().max(TASK_ENV_MAX_VALUE_LENGTH))
  .superRefine((entries, ctx) => {
    const keys = Object.keys(entries);
    if (keys.length > TASK_ENV_MAX_ENTRIES) {
      ctx.addIssue({
        code: 'custom',
        message: `环境变量条数超过上限（${TASK_ENV_MAX_ENTRIES} 条）`,
      });
    }
    for (const key of keys) {
      if ((TASK_ENV_FORBIDDEN_KEYS as readonly string[]).includes(key)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `禁止覆盖安全键 ${key}（由子进程环境固定管理）`,
        });
        continue;
      }
      const upper = key.toUpperCase();
      const prefixAllowed = TASK_ENV_ALLOWED_PREFIXES.some((prefix) => upper.startsWith(prefix));
      if (!prefixAllowed) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `变量名 ${key} 不在允许前缀内（${TASK_ENV_ALLOWED_PREFIXES.join(' / ')}）`,
        });
        continue;
      }
      if (key !== upper) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `变量名 ${key} 须为大写形态（如 ${upper}）`,
        });
      }
    }
  });

/** 任务环境变量表（键 = 变量名，值 = 明文；只在服务端内存/配置文件中出现） */
export type TaskEnvValues = z.infer<typeof TaskEnvRecordSchema>;

/** [K3] 对外单条（**永不**含明文） */
export const TaskEnvEntrySchema = z
  .object({
    key: z.string(),
    masked: z.string(),
  })
  .strict();

/** [K3] GET/PUT 响应视图（items 按 key 字典序） */
export const TaskEnvViewSchema = z
  .object({
    items: z.array(TaskEnvEntrySchema),
  })
  .strict();

/** [K3] PUT 请求体：entries 整表替换（`{}` = 清空，合法） */
export const PutTaskEnvBodySchema = z
  .object({
    entries: TaskEnvRecordSchema,
  })
  .strict();

export type TaskEnvEntry = z.infer<typeof TaskEnvEntrySchema>;
export type TaskEnvView = z.infer<typeof TaskEnvViewSchema>;
export type PutTaskEnvBody = z.infer<typeof PutTaskEnvBodySchema>;

/**
 * [K3] 掩码视图构造（GET 与 PUT 响应同形）：按 key 字典序，值只以掩码出现。
 * 纯函数——server 两个端点共用，测试可直接断言。
 */
export function taskEnvViewOf(entries: Record<string, string>): TaskEnvView {
  const items = Object.keys(entries)
    .sort()
    .map((key) => ({ key, masked: maskTaskEnvValue(entries[key] ?? '') }));
  return { items };
}
