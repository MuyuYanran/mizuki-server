import { Controller, Get } from '@nestjs/common';

/**
 * [阶段 P0a] System 控制器
 * [职责] 健康检查（P6 起本路由将加 @Public() 豁免认证）
 * [状态] ACTIVE
 */
@Controller('system')
export class SystemController {
  @Get('health')
  getHealth(): { status: string; service: string; uptime: number } {
    return { status: 'ok', service: 'mizuki-server', uptime: process.uptime() };
  }
}
