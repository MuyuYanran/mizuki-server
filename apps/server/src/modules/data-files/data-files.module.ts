/**
 * [阶段 P3] data-files 模块 — ts-morph 引擎（L1）
 * [职责] 装配引擎门面：FileLock / ValueCache 为可注入类，
 *   evaluator / serializer / syntax-check 为纯函数模块（无需 DI）。
 *   导出 DataFileService 供 L2 集合模块（P4）注入。
 * [状态] ACTIVE
 */
import { Module } from '@nestjs/common';
import { DataFileService } from './data-file.service';
import { FileLock } from './file-lock';
import { ValueCache } from './value-cache';

@Module({
  providers: [FileLock, ValueCache, DataFileService],
  exports: [DataFileService],
})
export class DataFilesModule {}
