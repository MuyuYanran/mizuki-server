/**
 * [阶段 P0b] common/logger — pino 日志基建
 * [职责] 全项目共享 pino 实例（级别由 MIZUKI_LOG_LEVEL 控制，默认 info）
 * [状态] ACTIVE
 *
 * 后续所有阶段的写入管线 / 异常处理 / 关键步骤日志均沿用本实例。
 */
import pino from 'pino';

export const logger = pino({
  level: process.env['MIZUKI_LOG_LEVEL'] ?? 'info',
});
