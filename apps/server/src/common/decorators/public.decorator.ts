/**
 * [阶段 P6] common/decorators/public — @Public() 公开路由标记
 * [职责] SetMetadata 标记豁免路由；全局 JwtAuthGuard 识别后跳过认证。
 *   豁免清单（P6 §3.3 逐字）：/public/**（P8 落地）、/system/health、
 *   /admin/auth/login、/admin/auth/refresh、/system/detect、/system/init。
 * [状态] ACTIVE
 */
import { SetMetadata } from '@nestjs/common';

/** 元数据键（守卫侧经 Reflector 读取） */
export const IS_PUBLIC_KEY = 'isPublic';

/** @Public()：标记方法或类为公开路由（免认证） */
export const Public = (): MethodDecorator & ClassDecorator => {
  return SetMetadata(IS_PUBLIC_KEY, true);
};
