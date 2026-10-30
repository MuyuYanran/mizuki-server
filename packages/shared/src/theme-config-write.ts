/**
 * [T3b-2b] 主题配置域写入契约（面板 → 服务端，ADR-028 §17.6）
 *
 * [管什么] **只校验信封**：请求体必须是 `{ values: <键值映射> }`，多一个顶层键就 400。
 * [为什么不管值的深层合法性] 那是两档 serde 的职责 —— `buildMizukiHeadOverrideSource`
 *   与 `buildShironeConfigYaml` 逐条镜像上游（`overrideLoader` / `assertSerializable`）的
 *   校验与**报错措辞**，用户在面板上看到的错误能直接对回上游构建报错。在这里再立一套 zod
 *   深校验会让两处判据漂移，而上游自己就把这条路封了：`config-overlay.mjs:4-9` 逐字
 *   「校验不写第二套 schema……另立 Zod/JSON Schema 只会漂移」。
 *
 * [为什么 `values` 不是 optional] 缺 `values` 与 `values: {}` 是两件事：
 *   前者是**请求形状错**（400 由本 schema 拒绝），后者是**语义无效的覆盖**
 *   （由写入器以 `empty-values` 拒绝并指引改用 `DELETE`）。二者必须可区分。
 * [状态] ACTIVE
 */
import { z } from 'zod';

/** `PUT /admin/config/domains/:domain` 的请求体 */
export const ThemeConfigWriteBodySchema = z
  .object({
    /** 该域**只写想改的键**的部分值；键序即生成物键序（serde 保证确定性） */
    values: z.record(z.string(), z.unknown()),
  })
  .strict();

export type ThemeConfigWriteBody = z.infer<typeof ThemeConfigWriteBodySchema>;
