/**
 * [U4-AI1/K1/K2/K3/K15/K16] ai/ai-config.service — AI 配置读写（掩码视图 / keep 语义 / env 覆盖）
 * [职责]
 *   - `view()`：GET/PUT 共用的**只读视图**，key 只以 `maskedKey` 出现（明文永不出本进程）；
 *   - `save(body)`：**深合并**后整段落盘，再 `resetAppConfigCache()` 使行为立刻生效；
 *   - `resolveActive()`：把当前配置解析成一次请求的目标（env 覆盖 → 出站闸 → 代理）。
 * [状态] ACTIVE
 *
 * 两个既有机制必须用对（U4-AI1 §7）：
 * ① `getAppConfig()` 是**进程级单例缓存**——写完配置不调 `resetAppConfigCache()`
 *    就会「保存成功但行为不变，要重启才生效」（P11 坑 5 先例，K15 验收点）；
 * ② `mergeAndPersistConfig(patch)` 是**浅合并**（`{...current, ...patch}`）且 patch 里
 *    `ai` 是整段替换——所以必须先读 `getAppConfig().ai`、在服务层深合并
 *    （profiles 按 id 对齐、key 依 keepApiKey），再把**整段**写回。
 *    只改 proxy 时若直接写 `{ ai: { proxy } }`，会把档案与 key 静默清空（K16 验收点）。
 *
 * 落盘是唯一通道：`mergeAndPersistConfig`（内部走 common/fs/atomic-write）。
 * 本文件**不**裸写 fs，也**不**新建第二套保存实现。
 */
import { BadRequestException } from '@nestjs/common';
import type { AiConfigView, AiProfile, AiProxy, AiPutConfigBody } from '@mizuki/shared';
import { assertSafeOutboundUrl, assertSafeProxyUrl } from '../../common/net/outbound';
import { logger } from '../../common/logger';
import { getAppConfig, mergeAndPersistConfig, resetAppConfigCache } from '../../config/app-config';

/** 落盘形态的档案（配置载体含 apiKey；对外视图永不含） */
type StoredProfile = AiProfile & { apiKey?: string };

/** 解析后的请求目标 */
export interface ResolvedTarget {
  profileId: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  proxy: AiProxy;
  allowPrivateNetwork: boolean;
  maxOutputTokens: number;
  temperature: number;
  timeoutMs: number;
  /** 配置意图：mode !== 'none'（system 下 NO_PROXY 命中时会直连，本进程无法感知） */
  viaProxy: boolean;
}

/** 解析失败分类（与 ping/chat 的对外分类同集合的子集） */
export type ResolveFailureCode = 'no_profile' | 'blocked_url';

export type ResolveResult =
  | { ok: true; target: ResolvedTarget }
  | { ok: false; code: ResolveFailureCode };

/** 掩码：长度 ≥ 8 → `••••` + 末 4 位；否则只回 `••••`（与 taskEnv 同口径） */
export function maskApiKey(key: string): string {
  return key.length >= 8 ? `••••${key.slice(-4)}` : '••••';
}

/** 业务语义 400（detail.code 供前端分支；message 不含任何 key 材料） */
function semanticBadRequest(message: string, code: string, extra?: Record<string, unknown>): never {
  throw new BadRequestException({
    message,
    detail: { code, ...(extra ?? {}) },
  });
}

export class AiConfigService {
  /** `MIZUKI_AI_API_KEY` 覆盖通道（空串视为未设置，便于容器里「置空回退」） */
  private envApiKey(): string | undefined {
    const raw = process.env['MIZUKI_AI_API_KEY'];
    return raw !== undefined && raw !== '' ? raw : undefined;
  }

  /** 只读视图：key 只以掩码出现，且**绝不**包含 `apiKey` 字段（K1） */
  view(): AiConfigView {
    const ai = getAppConfig().ai;
    const envKey = this.envApiKey();
    const hasConfigKey = ai.profiles.some(
      (profile) => profile.apiKey !== undefined && profile.apiKey !== '',
    );
    const keySource: AiConfigView['keySource'] = envKey
      ? 'env'
      : hasConfigKey
        ? 'config'
        : 'none';

    return {
      enabled: ai.enabled,
      activeProfileId: ai.activeProfileId ?? null,
      profiles: ai.profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        baseUrl: profile.baseUrl,
        model: profile.model,
        maskedKey: envKey
          ? maskApiKey(envKey)
          : profile.apiKey !== undefined && profile.apiKey !== ''
            ? maskApiKey(profile.apiKey)
            : '',
      })),
      proxy:
        ai.proxy.url !== undefined && ai.proxy.url !== ''
          ? { mode: ai.proxy.mode, url: ai.proxy.url }
          : { mode: ai.proxy.mode },
      allowPrivateNetwork: ai.allowPrivateNetwork,
      maxOutputTokens: ai.maxOutputTokens,
      temperature: ai.temperature,
      timeoutMs: ai.timeoutMs,
      keySource,
    };
  }

  /**
   * PUT /admin/ai/config：部分更新 → 深合并 → 整段写盘 → 失效缓存。
   * `keepApiKey` 省略/true = 未带 apiKey 的档案保留既有 key；false = 清空该档案 key。
   */
  save(body: AiPutConfigBody): AiConfigView {
    const current = getAppConfig().ai;
    const profiles = body.profiles === undefined ? current.profiles : this.mergeProfiles(body, current.profiles);
    const activeProfileId = this.resolveActiveId(body, current.activeProfileId, profiles);
    const proxy = body.proxy === undefined ? current.proxy : this.normalizeProxy(body.proxy);

    const next = {
      enabled: body.enabled ?? current.enabled,
      ...(activeProfileId !== undefined ? { activeProfileId } : {}),
      profiles,
      proxy,
      allowPrivateNetwork: body.allowPrivateNetwork ?? current.allowPrivateNetwork,
      maxOutputTokens: body.maxOutputTokens ?? current.maxOutputTokens,
      temperature: body.temperature ?? current.temperature,
      timeoutMs: body.timeoutMs ?? current.timeoutMs,
    };

    mergeAndPersistConfig({ ai: next });
    resetAppConfigCache();
    // 只记形态（条数/模式/开关），永不记 key 材料
    logger.info(
      {
        enabled: next.enabled,
        profileCount: next.profiles.length,
        proxyMode: next.proxy.mode,
        keepApiKey: body.keepApiKey !== false,
      },
      'AI 配置已保存（深合并后整段写入 + 缓存失效）',
    );
    return this.view();
  }

  /** profiles 深合并：按 id 对齐既有档案，key 依 keepApiKey 语义 */
  private mergeProfiles(body: AiPutConfigBody, current: StoredProfile[]): StoredProfile[] {
    if (body.profiles === undefined) {
      return current;
    }
    const keepKeys = body.keepApiKey !== false;
    const seen = new Set<string>();
    for (const incoming of body.profiles) {
      if (seen.has(incoming.id)) {
        semanticBadRequest('档案 id 重复', 'duplicate-profile-id', { id: incoming.id });
      }
      seen.add(incoming.id);
    }
    const previousById = new Map(current.map((profile) => [profile.id, profile]));
    return body.profiles.map((incoming) => {
      const previous = previousById.get(incoming.id);
      const provided = incoming.apiKey !== undefined && incoming.apiKey !== '';
      // 既有值：只有 keepKeys 为真才继承；空串按「未提供」处理（前端清空用 keepApiKey:false）
      const inherited = keepKeys ? previous?.apiKey : undefined;
      const apiKey = provided ? incoming.apiKey : inherited;
      return {
        id: incoming.id,
        name: incoming.name,
        baseUrl: incoming.baseUrl,
        model: incoming.model,
        ...(apiKey !== undefined && apiKey !== '' ? { apiKey } : {}),
      };
    });
  }

  /**
   * activeProfileId 裁决：
   * - body 显式给了 → 必须在合并后的档案里（否则 400 `unknown-profile`，防悬空指针）；
   * - 来自既有配置但档案已被删光/替换 → 置空（不让配置永久悬空；也不能静默指向别人）。
   */
  private resolveActiveId(
    body: AiPutConfigBody,
    currentActive: string | undefined,
    profiles: StoredProfile[],
  ): string | undefined {
    const exists = (id: string): boolean => profiles.some((profile) => profile.id === id);
    if (body.activeProfileId !== undefined) {
      if (!exists(body.activeProfileId)) {
        semanticBadRequest('activeProfileId 指向不存在的档案', 'unknown-profile', {
          activeProfileId: body.activeProfileId,
        });
      }
      return body.activeProfileId;
    }
    if (currentActive !== undefined && !exists(currentActive)) {
      logger.warn({ currentActive }, 'AI 配置：既有 activeProfileId 已无对应档案，保存时置空');
      return undefined;
    }
    return currentActive;
  }

  /** 代理规范化：custom 必须有合法 url；非 custom 丢弃 url（避免残留值误导面板） */
  private normalizeProxy(proxy: AiProxy): AiProxy {
    if (proxy.mode === 'custom') {
      if (proxy.url === undefined || proxy.url === '') {
        semanticBadRequest('proxy.mode=custom 时 url 必填', 'proxy-url-required');
      }
      assertSafeProxyUrl(proxy.url); // 只验协议；代理允许回环/私网
      return { mode: 'custom', url: proxy.url };
    }
    return { mode: proxy.mode };
  }

  /**
   * 解析当前请求目标：
   * - activeProfileId 缺省 → 取第一个档案（单一档案开箱可用）；无档案 → no_profile；
   * - env 覆盖：`MIZUKI_AI_API_KEY` > 档案 key；`MIZUKI_AI_BASE_URL` / `MIZUKI_AI_MODEL`
   *   只覆盖 **active profile**（容器化部署通道）；
   * - **目标 baseUrl 恒过闸**（与是否配代理无关）；代理地址在 normalizeProxy/save 与
   *   此处各校验一次协议（纵深防御）。
   */
  resolveActive(): ResolveResult {
    const ai = getAppConfig().ai;
    const profile = ai.activeProfileId
      ? ai.profiles.find((item) => item.id === ai.activeProfileId)
      : ai.profiles[0];
    if (profile === undefined) {
      return { ok: false, code: 'no_profile' };
    }

    const baseUrl = process.env['MIZUKI_AI_BASE_URL'] ?? profile.baseUrl;
    const model = process.env['MIZUKI_AI_MODEL'] ?? profile.model;
    const apiKey = this.envApiKey() ?? profile.apiKey;

    let proxy: AiProxy;
    try {
      proxy = this.normalizeProxy(ai.proxy);
    } catch {
      // 手改配置造成的「custom 无 url / 非 http(s)」= 配置不可用，按出站被拒分类
      return { ok: false, code: 'blocked_url' };
    }

    try {
      assertSafeOutboundUrl(baseUrl, { allowPrivateNetwork: ai.allowPrivateNetwork });
    } catch {
      return { ok: false, code: 'blocked_url' };
    }

    return {
      ok: true,
      target: {
        profileId: profile.id,
        baseUrl,
        model,
        ...(apiKey !== undefined && apiKey !== '' ? { apiKey } : {}),
        proxy,
        allowPrivateNetwork: ai.allowPrivateNetwork,
        maxOutputTokens: ai.maxOutputTokens,
        temperature: ai.temperature,
        timeoutMs: ai.timeoutMs,
        viaProxy: proxy.mode !== 'none',
      },
    };
  }
}
