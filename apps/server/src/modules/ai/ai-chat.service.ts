/**
 * [U4-AI1/K5/K6/K7/K8/K15] ai/ai-chat.service — 流式编排（闸 → provider → 帧序列）
 * [职责] `POST /admin/ai/ping` 与 `POST /admin/ai/chat` 的全部业务编排：
 *   解析配置 → 出站闸 → 上游请求 → 帧序列（delta* → usage? → done）/ 错误分帧。
 * [状态] ACTIVE
 *
 * 七条必做项的落点（U4-AI1 §5，逐条）：
 * 1. 头：`sse.ts` 的 startSse（含 `X-Accel-Buffering: no`）；
 * 2. **首字节前错误 → 正常异常路径**：headers 只在「上游 ok + 有 body」之后才写，
 *    此前的失败一律 throw（全局过滤器输出 `{code,message,detail}` + 正确状态码）；
 *    **首字节后错误 → 只发 `event: error` 再 end()**，绝不再 touch 状态码
 *    （否则 `ERR_HTTP_HEADERS_SENT`）；
 * 3. 客户端断开 → abort 上游：注意 Node 26 实测 POST + body-parser 已消费后，
 *    `req` 的 `'close'` 会在 handler 进入后**立刻**触发（`req.complete=true`），
 *    此时客户端还在——所以 `req.on('close')` 只在**请求体未收完**（真中断）时 abort；
 *    流式阶段的断连由 `res.on('close')` + `!res.writableEnded` 兜底（探针结果见
 *    交付报告「实现注记」）。
 * 4. 上游非 200：只按状态码分类，**不读 body、不回显**（可能含 key 片段/内部 URL）；
 * 5. 终止保底：`finally` 清 timeout / 摘监听 / 销毁 dispatcher；总超时到点 abort
 *    并按是否已发首字节决定 error 帧或异常；`res.writableEnded` 为真时不再写帧；
 * 6. 帧解析：按 `\n\n` 切（先把 CRLF 归一），取 `data:` 行；`[DONE]` → done；
 *    `choices[0].delta.content` 为空串不发 delta（避免前端空白抖动）；
 * 7. 原生 `@Res()`（不用 `@Sse()`：GET-only 装不下 body）。
 *
 * 契约缺口（如实登记，不擅自替 U4-AI2 做决定）：
 *   `AiChatBody.action` / `context` 本期**透传语义未定**——`messages` 原样发给上游，
 *   `context.text` 不注入（避免与前端自行组装重复烧 token），`action` 不参与 prompt。
 *   二者仍按契约校验上限，并在审计摘要里出 `action` / `contextChars`。
 */
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AI_SSE, type AiChatBody } from '@mizuki/shared';
import { getAppConfig } from '../../config/app-config';
import { logger } from '../../common/logger';
import { AiConfigService } from './ai-config.service';
// [U4-AI3/A] 用量台账服务：值导入（Nest DI 依赖运行时元数据，import type 会擦除 design:paramtypes）
import { AiUsageService } from './ai-usage.service';
import {
  AI_FAILURE_MESSAGES,
  classifyFetchError,
  classifyUpstreamStatus,
  createProxyDispatcher,
  requestChatCompletion,
  type AiFailureCode,
  type ChatMessage,
} from './provider/openai-compatible';
import { endSse, startSse, writeSseFrame } from './sse';
import { buildUpstreamMessages } from './prompts';

/** ping 成功形态（§4） */
export interface AiPingSuccess {
  ok: true;
  latencyMs: number;
  viaProxy: boolean;
  model: string;
}

/** ping 失败形态（§4）：只给分类值，不回显上游 body / URL */
export interface AiPingFailure {
  ok: false;
  code: AiFailureCode;
  latencyMs: number;
}

export type AiPingResult = AiPingSuccess | AiPingFailure;

/** 上游流式 chunk 的最小结构（只取用到的字段） */
interface UpstreamChunk {
  choices?: { delta?: { content?: string } }[];
  /** 真上游（DeepSeek 等）会在**每个** chunk 上带 `"usage": null`，末帧才给值 —— 见 K17 */
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/** 从一帧里取 `data:` 内容（多行 data 按 SSE 规范用 \n 连接） */
function extractSseData(frame: string): string | null {
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  return dataLines.length === 0 ? null : dataLines.join('\n');
}

/** 分类 → 首字节前异常（状态码语义：超时 504 / 其余上游问题 502 / 配置问题 400） */
function failureException(code: AiFailureCode): HttpException {
  const message = AI_FAILURE_MESSAGES[code];
  const body = { message, detail: { code } };
  if (code === 'upstream_timeout') {
    return new GatewayTimeoutException(body);
  }
  if (code === 'blocked_url' || code === 'no_profile') {
    return new BadRequestException(body);
  }
  return new BadGatewayException(body);
}

@Injectable()
export class AiChatService {
  constructor(
    private readonly config: AiConfigService,
    // [U4-AI3/A] 用量台账（旁路写入：其失败绝不影响主响应，见 ai-usage.service 文件头）
    private readonly usage: AiUsageService,
  ) {}

  /**
   * 连通性测试：用 activeProfile 发一条最小请求（`max_tokens: 8`）。
   * 无论成功失败都**不抛**——失败也回 `{ ok: false, code, latencyMs }`（§4）。
   *
   * [U4-AI3/A] 同时记一笔用量：ping 也真实消耗上游额度（虽小），
   * 且是「档案是否可用」的证据来源 —— 漏记会让用量面板看不到配置错误。
   */
  async ping(): Promise<AiPingResult> {
    const started = Date.now();
    const resolved = this.config.resolveActive();
    if (!resolved.ok) {
      // 未发出请求：不记用量（没有消耗，记了反而污染统计）
      return { ok: false, code: resolved.code, latencyMs: Date.now() - started };
    }
    const { target } = resolved;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), target.timeoutMs);
    const dispatcher = createProxyDispatcher(target.proxy);
    try {
      const result = await requestChatCompletion(
        {
          target,
          messages: [{ role: 'user', content: 'ping' }],
          maxOutputTokens: 8,
          temperature: 0,
          stream: false,
          signal: controller.signal,
        },
        dispatcher,
      );
      if (!result.ok) {
        await this.recordPing(target, Date.now() - started, 'error', result.code);
        return { ok: false, code: result.code, latencyMs: Date.now() - started };
      }
      // 只取消 body，不读：上游错误 body 可能含内部 URL/key 片段，读进来就有泄漏面
      await result.response.body?.cancel().catch(() => undefined);
      if (!result.response.ok) {
        const code = classifyUpstreamStatus(result.response.status);
        await this.recordPing(target, Date.now() - started, 'error', code);
        return { ok: false, code, latencyMs: Date.now() - started };
      }
      await this.recordPing(target, Date.now() - started, 'ok', null);
      return {
        ok: true,
        latencyMs: Date.now() - started,
        viaProxy: target.viaProxy,
        model: target.model,
      };
    } catch (error) {
      const code = classifyFetchError(error);
      await this.recordPing(target, Date.now() - started, 'error', code);
      return { ok: false, code, latencyMs: Date.now() - started };
    } finally {
      clearTimeout(timer);
      if (dispatcher) {
        try {
          await dispatcher.destroy();
        } catch {
          // 销毁失败不影响结果（连接已随响应结束/放弃）
        }
      }
    }
  }

  /**
   * [U4-AI3/A] ping 的用量记录。
   * ping 是**非流式**且**不读响应体**（安全考虑），因此拿不到 token usage ⇒
   * 三个 token 列一律 `null`（未知），**不写 0**（0 是「零消耗」，语义不同）。
   */
  private async recordPing(
    target: { profileId: string; model: string },
    durationMs: number,
    status: 'ok' | 'error',
    errorCode: string | null,
  ): Promise<void> {
    await this.usage.record({
      scene: 'ping',
      action: null,
      profileId: target.profileId,
      model: target.model,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      durationMs,
      status,
      errorCode,
    });
  }

  /**
   * 流式聊天：写 SSE 帧到 `res`。
   * 返回值在流结束（或客户端断开）时 resolve；首字节前失败时 throw（由异常过滤器输出）。
   */
  async stream(body: AiChatBody, req: Request, res: Response): Promise<void> {
    if (!getAppConfig().ai.enabled) {
      throw new ServiceUnavailableException({
        message: 'AI 功能未启用',
        detail: { code: 'ai_disabled' },
      });
    }
    const resolved = this.config.resolveActive();
    if (!resolved.ok) {
      throw failureException(resolved.code);
    }
    const { target } = resolved;

    const controller = new AbortController();
    let timedOut = false;
    let clientGone = false;
    const abortForDisconnect = (): void => {
      if (!clientGone) {
        clientGone = true;
        controller.abort();
      }
    };
    // 证据（Node 26 实测）：POST 的 body 已被 body-parser 消费后，req 的 'close'
    // 在 handler 进入后立刻触发且 req.complete=true——此时客户端仍在。故只在
    // 「请求体没读完」（真正的上传中断）时按断连处理；流式阶段的断连靠 res 'close'。
    const onRequestClose = (): void => {
      if (!req.complete) {
        abortForDisconnect();
      }
    };
    const onResponseClose = (): void => {
      if (!res.writableEnded) {
        abortForDisconnect();
      }
    };
    req.on('close', onRequestClose);
    res.on('close', onResponseClose);

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, target.timeoutMs);
    const dispatcher = createProxyDispatcher(target.proxy);
    let firstByteSent = false;
    // [U4-AI3/A] 流式用量收集器：由 pump 填充，在 finally 统一落账。
    // 为什么用可变对象而不是让 pump 返回：pump 在异常路径下**不返回**（抛出），
    // 而用量在异常时同样要记（那正是最需要记账的场景）⇒ 只有共享可变状态能覆盖全部出口。
    const collected: { promptTokens: number | null; completionTokens: number | null } = {
      promptTokens: null,
      completionTokens: null,
    };
    let streamErrorCode: string | null = null;
    const streamStarted = Date.now();

    try {
      const result = await requestChatCompletion(
        {
          target,
          messages: this.buildMessages(body),
          maxOutputTokens: target.maxOutputTokens,
          temperature: target.temperature,
          stream: true,
          signal: controller.signal,
        },
        dispatcher,
      );
      if (!result.ok) {
        if (clientGone) {
          return; // 客户端已走：不再产生任何响应（上游已被 abort）
        }
        throw failureException(result.code);
      }
      const upstream = result.response;
      if (!upstream.ok) {
        await upstream.body?.cancel().catch(() => undefined);
        if (clientGone) {
          return;
        }
        throw failureException(classifyUpstreamStatus(upstream.status));
      }
      if (upstream.body === null) {
        throw failureException('network');
      }

      // 到这里上游已确认可流式：此时才写头（首字节前错误已全部走完异常路径）
      startSse(res);
      firstByteSent = true;
      await this.pump(upstream.body, res, () => clientGone, collected);
      endSse(res);
    } catch (error) {
      if (firstByteSent) {
        // 首字节后：状态码不可再改，只能发 error 帧（§5-2）
        const code: AiFailureCode = timedOut ? 'upstream_timeout' : classifyFetchError(error);
        streamErrorCode = code;
        // 运维诊断：只记错误类型与分类码。**不记**上游 body / 请求头 / URL
        //（真链路排障必需——真上游在此分支失败时，对外只有一个分类码，没有这条日志
        // 就只能靠猜；U4-AI1 真链路验收时正是靠它定位到 undici stream 读端错误）。
        logger.warn(
          {
            errName: error instanceof Error ? error.name : typeof error,
            errMessage: error instanceof Error ? error.message : '',
            code,
          },
          'AI 流式在首字节后中断',
        );
        if (!res.writableEnded) {
          writeSseFrame(res, AI_SSE.error, { code, message: AI_FAILURE_MESSAGES[code] });
          endSse(res);
        }
        return;
      }
      if (clientGone) {
        return;
      }
      // 首字节前失败：此时上游未产生可见输出，但仍可能已消耗 prompt token
      // ⇒ 记 error（拿不到 usage 时 token 为 null，不写 0）
      streamErrorCode = timedOut ? 'upstream_timeout' : classifyFetchError(error);
      throw error instanceof HttpException ? error : failureException(classifyFetchError(error));
    } finally {
      clearTimeout(timer);
      req.off('close', onRequestClose);
      res.off('close', onResponseClose);
      if (dispatcher) {
        try {
          await dispatcher.destroy();
        } catch {
          // 同上：连接已结束，销毁失败仅属清理噪声
        }
      }
      // [U4-AI3/A] 统一落账：三态判定一条规则，见 shared/ai-usage.ts 文件头 ①。
      //   「客户端已断开」优先于「有错误码」：断连会让 classifyFetchError 把
      //   AbortError 归成网络错误，但那**不是服务故障**，计进错误率会随用户操作习惯失真。
      const status: 'ok' | 'error' | 'aborted' = clientGone
        ? 'aborted'
        : streamErrorCode === null
          ? 'ok'
          : 'error';
      await this.usage.record({
        scene: 'chat',
        action: body.action ?? null,
        profileId: target.profileId,
        model: target.model,
        promptTokens: collected.promptTokens,
        completionTokens: collected.completionTokens,
        // total 由两端相加得出：上游的 total 字段可能缺失，本仓不额外信任它
        totalTokens:
          collected.promptTokens === null && collected.completionTokens === null
            ? null
            : (collected.promptTokens ?? 0) + (collected.completionTokens ?? 0),
        durationMs: Date.now() - streamStarted,
        status,
        // aborted 不记错误码：它不表达故障，记了会让「按错误码排查」出现噪声
        errorCode: status === 'error' ? streamErrorCode : null,
      });
    }
  }

  /**
   * 组装发往上游的消息。
   * [U4-AI1/§6 补齐] 原实现「只透传 messages」会把 `action` 与 `context.text` 静默丢弃
   * （接收了但不用 = 润色/摘要拿不到正文），现委托给 `prompts.buildUpstreamMessages`：
   * system（基础 + 动作指令）→ 调用方 messages → `<document>` 包裹的稿件。
   */
  private buildMessages(body: AiChatBody): ChatMessage[] {
    return buildUpstreamMessages(body);
  }

  /**
   * 拉取上游流并按帧写客户端。
   * - 正常终止：`[DONE]` 或上游 EOF → 恰好一帧 `done`；
   * - 异常（网络断开/超时）：抛出，由调用方决定「首字节前异常 / 首字节后 error 帧」；
   * - 客户端已断开：收到 `stopped()` 为真或写帧失败即停，并 cancel 读端（停止烧 token）。
   *
   * 注意：`stopped()` 只表达**客户端已断开**——超时不在这里短路，必须让 read()
   *   抛 AbortError 上来，才能走「首字节后 error 帧」而不是误发 done。
   */
  private async pump(
    upstreamBody: NodeReadableStream<Uint8Array>,
    res: Response,
    stopped: () => boolean,
    collected?: { promptTokens: number | null; completionTokens: number | null },
  ): Promise<void> {
    const reader = upstreamBody.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let usageSent = false;
    let doneSent = false;
    let terminated = false;

    const sendDone = (): void => {
      if (!doneSent) {
        doneSent = true;
        writeSseFrame(res, AI_SSE.done, {});
      }
    };

    /** 处理一帧；返回 false 表示「已终止（done 或客户端断开）」 */
    const handleFrame = (frame: string): boolean => {
      const data = extractSseData(frame);
      if (data === null) {
        return true;
      }
      if (data === '[DONE]') {
        sendDone();
        return false;
      }
      let chunk: UpstreamChunk;
      try {
        chunk = JSON.parse(data) as UpstreamChunk;
      } catch {
        return true; // 非 JSON 帧（上游注释/心跳）：忽略
      }
      // 先发本 chunk 的 delta、再发 usage：同一 chunk 同时带 content 与 usage 时
      // 也保持「delta* → usage → done」的全局帧序（契约 §5 的帧序列）
      const text = chunk.choices?.[0]?.delta?.content;
      let written = true;
      if (typeof text === 'string' && text !== '') {
        written = writeSseFrame(res, AI_SSE.delta, { text });
      }
      const usage = chunk.usage;
      // [K17 真链路修复] 必须同时排除 null：OpenAI 兼容上游在**非末帧**普遍发
      // `"usage": null`（DeepSeek 实测如此），只判 `!== undefined` 会对 null 取属性抛
      // TypeError → 首字节后中断 → 用户看到 error 帧。假上游不模拟这一点就会漏检。
      if (usage !== undefined && usage !== null && !usageSent) {
        usageSent = true;
        // [U4-AI3/A] 同步填充用量收集器（台账用），与发给前端的 usage 帧同源
        if (collected !== undefined) {
          collected.promptTokens = usage.prompt_tokens ?? 0;
          collected.completionTokens = usage.completion_tokens ?? 0;
        }
        writeSseFrame(res, AI_SSE.usage, {
          promptTokens: usage.prompt_tokens ?? 0,
          completionTokens: usage.completion_tokens ?? 0,
        });
      }
      return written;
    };

    try {
      while (!terminated) {
        if (stopped()) {
          break;
        }
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value !== undefined) {
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        }
        let sep = buffer.indexOf('\n\n');
        while (sep !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          if (!handleFrame(frame)) {
            terminated = true;
            break;
          }
          sep = buffer.indexOf('\n\n');
        }
      }
      // 上游正常 EOF（没发 [DONE]）也要收尾；客户端主动终止时不补 done
      if (!doneSent && !terminated && !stopped()) {
        sendDone();
      }
    } finally {
      // 客户端断开 / 提前 done：取消读端，避免继续下载上游流（不继续烧 token）
      if (stopped() || terminated) {
        await reader.cancel().catch(() => undefined);
      }
    }
  }
}
