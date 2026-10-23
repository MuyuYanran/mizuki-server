/**
 * [U4-AI1/K5] ai/sse — SSE 帧写入单源
 * [职责] `POST /admin/ai/chat` 的流式响应只经本文件写字节，保证七条必做项里的
 *   帧格式、响应头与「写完不再写」三件事只有一处实现：
 *   - 头：`text/event-stream; charset=utf-8` / `no-cache, no-transform` /
 *     `keep-alive` / **`X-Accel-Buffering: no`**（缺它则 nginx 反代缓冲整个流，
 *     面板看起来像「一次性返回」）；
 *   - 帧：`event: <name>\ndata: <json>\n\n`（name 取自 shared 的 AI_SSE，禁字面量）；
 *   - 收尾：`end()` 幂等；已 `writableEnded` / 已 `destroyed` 时**不再写**
 *     （客户端断开后继续写会触发 `ERR_STREAM_WRITE_AFTER_END` 噪声）。
 * [状态] ACTIVE
 *
 * 纪律：本文件不区分业务语义（不知道 delta/usage/done/error 的含义），
 *   只负责「怎么把一帧写到线上」。
 */
import type { Response } from 'express';
import type { AiSseEvent } from '@mizuki/shared';

/**
 * 建立 SSE 响应：状态码 200 + 四个必需头 + `flushHeaders()`。
 * **调用时机**：上游已确认 `ok === true` 之后（首字节前错误必须走 JSON 异常路径，
 * 否则状态码就改不了了——见 ai-chat.service 的注释）。
 */
export function startSse(res: Response): void {
  if (res.headersSent || res.writableEnded) {
    return;
  }
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

/**
 * 写一帧。返回是否真的写出（客户端已断开时为 false，调用方可据此收尾）。
 * `data` 一律 `JSON.stringify`：禁止手拼 JSON 字符串（引号/换行会破坏帧边界）。
 */
export function writeSseFrame(res: Response, event: AiSseEvent, data: unknown): boolean {
  if (res.writableEnded || res.destroyed) {
    return false;
  }
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  return true;
}

/** 结束流（幂等）。客户端已断开（socket destroyed）时不再 end，避免 WRITE_AFTER_END 噪声。 */
export function endSse(res: Response): void {
  if (!res.writableEnded && !res.destroyed) {
    res.end();
  }
}
