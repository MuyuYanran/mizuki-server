/**
 * [阶段 P3] data-files/data-file.service — 引擎门面
 * [职责] 对外提供 readCollection / mutateCollection；编排 8 步写管线
 *   （MASTER-PLAN §6.4，顺序不可变）：读盘哈希 → AST 求值深拷贝变更 →
 *   zod 整体校验 → 序列化 + 语法校验 → 陈旧检测（重试 1 次，仍冲突 409）→
 *   pre_write 备份 → 原子写入 → 失效缓存。
 * [状态] ACTIVE
 *
 * - 所有路径经 safeJoin(mizukiRoot, relFile)（P1 路径监狱）；
 * - 备份直接调用 infra/backup（共享底层，MASTER-PLAN §2 决策 6）；
 * - 事件发射不在本模块（引擎保持纯粹）：content.changed 由调用方（P4）
 *   在成功出口负责；本服务返回写入后的新值供调用方组装事件。
 */
import fs from 'node:fs';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { z } from 'zod';
import { sha256Text } from '../../common/crypto/hash';
import { atomicWriteFile } from '../../common/fs/atomic-write';
import { toMizukiAbs } from '../../common/fs/mizuki-root';
import { logger } from '../../common/logger';
import { safeParseIssues } from '../../common/validation/zod-issues';
import { type BackupOptions, BACKUP_OPTIONS, BackupService } from '../../infra/backup/backup.service';
import { astToValue, getVariableDeclarationOrThrow, loadSourceFile } from './evaluator';
import { valueToTsLiteral } from './serializer';
import { assertSyntaxValid } from './syntax-check';
import { FileLock } from './file-lock';
import { ValueCache } from './value-cache';

/** 陈旧冲突重试次数（MASTER-PLAN §6.4 第 5 步：整体重试 1 次） */
const MAX_RETRY = 1;

@Injectable()
export class DataFileService {
  constructor(
    private readonly lock: FileLock,
    private readonly cache: ValueCache,
    @Inject(BackupService) private readonly backup: BackupService,
    @Inject(BACKUP_OPTIONS) private readonly options: BackupOptions,
  ) {}

  /**
   * 读取集合当前值（走 value-cache：mtime+size 未变时命中缓存）。
   * @param relFile 相对 Mizuki 根的数据文件路径（POSIX 风格，如 src/data/diary.ts）
   * @param varName 导出变量名（如 diaryData）
   */
  readCollection<T = unknown>(relFile: string, varName: string): T {
    const abs = this.resolveAbs(relFile);
    return this.cache.get<T>(abs, () => {
      const sf = loadSourceFile(abs);
      // displayPath = relFile：错误信息投影相对路径，响应体不泄露磁盘绝对路径（E1）
      const decl = getVariableDeclarationOrThrow(sf, varName, relFile);
      const initializer = decl.getInitializer();
      if (!initializer) {
        throw new BadRequestException(`导出 ${varName} 缺少初始化表达式：${relFile}`);
      }
      return astToValue(initializer, abs) as T;
    });
  }

  /**
   * 8 步写管线（顺序不可变，MASTER-PLAN §6.4）。同一文件经 FileLock 串行。
   * @param mutate 收到当前值的深拷贝，返回新值（原地修改亦可；支持 async）
   * @param schema 可选 zod 整体校验（P4 从注册表传入；未传则跳过第 3 步）
   * @returns 写入后的新值（供调用方组装 content.changed 事件）
   */
  async mutateCollection<T>(
    relFile: string,
    varName: string,
    mutate: (value: T) => T | Promise<T>,
    schema?: z.ZodType,
  ): Promise<T> {
    const abs = this.resolveAbs(relFile);
    return this.lock.withLock(abs, () => this.attempt<T>(abs, relFile, varName, mutate, schema, 0));
  }

  // ── 内部实现 ──

  /** 单次尝试（含陈旧检测后的整体重试） */
  private async attempt<T>(
    absFile: string,
    relFile: string,
    varName: string,
    mutate: (value: T) => T | Promise<T>,
    schema: z.ZodType | undefined,
    retry: number,
  ): Promise<T> {
    // 1. 读盘 + 记录原文哈希
    const original = fs.readFileSync(absFile, 'utf8');
    const originalHash = sha256Text(original);

    // 2. AST 求值 → 深拷贝 → 用户变更
    const sourceFile = loadSourceFile(absFile, original);
    const decl = getVariableDeclarationOrThrow(sourceFile, varName, relFile);
    const initializer = decl.getInitializer();
    if (!initializer) {
      throw new BadRequestException(`导出 ${varName} 缺少初始化表达式：${relFile}`);
    }
    const current = astToValue(initializer, absFile) as T;
    const next = await mutate(structuredClone(current));

    // 3. zod 整体校验（未传 schema 则跳过）
    //    [Wave-2/E2] 失败由「ZodError 直达 500」改为 400 + detail.issues：
    //    整体校验失败源于用户提交的条目组合，属可自助修正问题；前端消费
    //    detail.issues[].{path,message} 做字段级提示（形状与路由级管道一致）。
    if (schema) {
      const checked = safeParseIssues(schema, next);
      if (!checked.ok) {
        logger.warn({ file: relFile, var: varName }, '数据文件整体校验失败（400）');
        throw new BadRequestException({
          message: `数据文件整体校验失败：${relFile}`,
          detail: { issues: checked.issues },
        });
      }
      logger.debug({ file: relFile, var: varName }, 'zod 校验通过');
    }

    // 4. 生成新文本 + 语法校验（syntax error 必须为 0）
    //    注：用 replaceWithText 精确替换初始化表达式区域——setInitializer
    //    会对多行文本追加缩进（已由 golden 字节测试验证，见 P3 交付报告）。
    initializer.replaceWithText(valueToTsLiteral(next));
    const text = sourceFile.getFullText();
    assertSyntaxValid(text, relFile);

    // 5. 陈旧检测：重读磁盘哈希 ≠ 原文哈希 → 整体重试 1 次，仍冲突 409
    const diskNow = fs.readFileSync(absFile, 'utf8');
    if (sha256Text(diskNow) !== originalHash) {
      if (retry < MAX_RETRY) {
        logger.warn({ file: relFile, attempt: retry + 1 }, '检测到外部修改，整体重试写入');
        return this.attempt<T>(absFile, relFile, varName, mutate, schema, retry + 1);
      }
      logger.warn({ file: relFile }, '外部修改持续存在，写入冲突（409）');
      throw new ConflictException(`数据文件已被外部修改，写入冲突：${relFile}`);
    }

    // 6. 备份原文件（pre_write 快照；新文件首写无物可备时返回 undefined，属正常）
    await this.backup.preWriteBackup(absFile);

    // 7. 原子写入：同目录临时文件 + rename 覆盖（common/fs/atomic-write 单源）
    atomicWriteFile(absFile, text);

    // 8. 失效 value-cache，返回新值
    this.cache.invalidate(absFile);
    logger.info({ file: relFile, var: varName }, '数据文件写入完成（pre_write 备份 + 原子写）');
    return next;
  }

  /** relFile → 绝对路径（root 未配置 400 / 越界 403，见 common/fs/mizuki-root） */
  private resolveAbs(relFile: string): string {
    return toMizukiAbs(this.options.mizukiRoot, relFile, {
      missingMessage: 'Mizuki 项目根目录未配置，无法读写数据文件（请先完成初始化）',
    });
  }
}
