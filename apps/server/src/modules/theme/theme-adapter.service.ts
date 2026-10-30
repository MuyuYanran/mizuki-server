/**
 * [T1→T2] theme/theme-adapter.service — 主题识别与能力画像（Nest 薄包装）
 * [职责] 实现已**逐字下沉** L0：`common/theme/theme-adapter.ts`（check 结果：除
 *   `@Injectable()` 与类名外与 T1 原实现零差异）。本类只保留 DI 装饰器与继承，
 *   使 ThemeModule 的 providers/exports 与 `GET /admin/theme/profile` 行为逐字不变。
 * [为何下沉] L2 的 collections 需按当前主题 kind 取集合表；L2 之间禁止互导
 *   （eslint boundaries error 级），实现不能留在 modules/theme。
 * [状态] ACTIVE
 */
import { Injectable } from '@nestjs/common';
import { ThemeAdapter } from '../../common/theme/theme-adapter';

@Injectable()
export class ThemeAdapterService extends ThemeAdapter {}
