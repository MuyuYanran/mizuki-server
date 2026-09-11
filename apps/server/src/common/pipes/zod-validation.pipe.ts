/**
 * [阶段 P1] common/pipes/zod-validation — 全局 zod 校验管道
 * [职责] 基于 zod schema 校验请求数据（MASTER-PLAN §9 守则 4：所有外部输入必须过 zod）。
 *   用法：业务路由上 @UsePipes(new ZodValidationPipe(Schema)) 显式声明；
 *   全局默认 schema 的兜底挂载点见 app.setup.ts 注释（P1 时点各业务 schema
 *   由后续阶段在路由级声明）。
 *   校验失败抛 BadRequestException，经 P0b 统一异常过滤器输出
 *   { code, message, detail }，detail 携带 zod issues（字段路径 + 错误信息）。
 * [状态] ACTIVE
 */
import { type PipeTransform } from '@nestjs/common';
import { z } from 'zod';
import { parseOrBadRequest } from '../validation/zod-issues';

export class ZodValidationPipe implements PipeTransform<unknown, unknown> {
  constructor(private readonly schema: z.ZodType) {}

  transform(value: unknown): unknown {
    // 400 + detail.issues 形状单源（common/validation/zod-issues）
    return parseOrBadRequest(this.schema, value, '请求体校验失败');
  }
}
