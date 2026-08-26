/**
 * [阶段 P7] common/registry/media-reference.registry — 媒体引用注册表宿主
 * [职责] MediaReferenceContributor 注册与聚合（MASTER-PLAN §2 决策 6：
 *   同步反查走注册表——media 不认识引用方，各内容模块自注册检查器）。
 *   位于 common/（L0），供 media（消费方）与各注册方共同依赖，
 *   避免 L2 模块互 import（boundaries 强制）。
 * [状态] ACTIVE
 *
 * 纪律：collectAll 对每个贡献者调用做 try/catch，失败记日志不冒泡
 * （注册表聚合不得阻塞删除检查之外的任何流程）。
 */
import { Global, Module, Injectable } from '@nestjs/common';
import type { MediaReference, MediaReferenceContributor } from '@mizuki/shared';
import { logger } from '../logger';

@Injectable()
export class MediaReferenceRegistry {
  private readonly contributors = new Map<string, MediaReferenceContributor>();

  /** 注册贡献者（name 唯一；重复注册拒绝并告警，防止引用检查被覆盖） */
  register(contributor: MediaReferenceContributor): void {
    if (this.contributors.has(contributor.name)) {
      logger.warn({ name: contributor.name }, 'MediaReferenceContributor 重复注册，已拒绝');
      return;
    }
    this.contributors.set(contributor.name, contributor);
    logger.info({ name: contributor.name }, 'MediaReferenceContributor 已注册');
  }

  /** 已注册贡献者名（测试断言 / 诊断用） */
  names(): string[] {
    return [...this.contributors.keys()];
  }

  /** 聚合全部注册方的引用；单个贡献者失败仅记日志，不冒泡 */
  async collectAll(): Promise<MediaReference[]> {
    const all: MediaReference[] = [];
    for (const contributor of this.contributors.values()) {
      try {
        const refs = await contributor.collectReferences();
        all.push(...refs);
      } catch (error) {
        logger.error({ err: error, name: contributor.name }, '媒体引用聚合：贡献者失败（跳过）');
      }
    }
    return all;
  }
}

/** 全局注册表模块（app.module.ts 注册；各内容模块经 DI 取用并自注册） */
@Global()
@Module({
  providers: [MediaReferenceRegistry],
  exports: [MediaReferenceRegistry],
})
export class MediaReferenceRegistryModule {}
