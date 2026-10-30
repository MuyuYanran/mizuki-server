/**
 * [T5b-2] shirone-content 模块 —— Shirone 独有的 series / moments 内容集合
 *
 * [职责] 对 `<目标根>/<slug>.md` 做扁平扫描与 CRUD。目标根由 T5b-1 的
 *        `resolveContentSubdirTarget` 动态给出（local ⇒ 代码仓；external ⇒ 内容仓），
 *        因此 external 档下写的是**真源**，不是会被 sync 裁掉的副本。
 * [状态] ACTIVE
 *
 * 为什么不进 `article` 统一索引（dj 2026-10-30 裁定）：series 是系列元数据、
 * moments 是短动态，二者在业务语义、字段结构、排序维度上都与长文 posts 不同；
 * 塞进 article 表只会污染文章索引与搜索面。两者体量极小，纯文件扫描最干净。
 *
 * 依赖注入：DbModule 与 InfraBackupModule 均为 @Global，无需在 imports 重复声明。
 * 分层：本模块不在 eslint boundaries 的 elements 清单内（同 preview / site-config / theme），
 *      但同样只依赖 common/（L0）、infra/（L0）与 @mizuki/shared。
 */
import { Module } from '@nestjs/common';
import { ShironeContentController } from './shirone-content.controller';
import { ShironeContentService } from './shirone-content.service';

@Module({
  controllers: [ShironeContentController],
  providers: [ShironeContentService],
})
export class ShironeContentModule {}
