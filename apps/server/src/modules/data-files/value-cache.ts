/**
 * [阶段 P3] data-files/value-cache — mtime+size 键的读缓存
 * [职责] 以「文件 mtime + size」为键缓存求值结果，避免公开 API 重复
 *   ts-morph 解析（MASTER-PLAN §6.4 value-cache 说明）；写管线第 8 步
 *   主动失效对应条目。
 * [状态] ACTIVE
 *
 * 注意：缓存返回的是同一对象引用——调用方不得原地修改返回值
 * （写路径一律走 mutateCollection 的深拷贝变更）。
 */
import fs from 'node:fs';
import { Injectable } from '@nestjs/common';

interface CacheEntry {
  mtimeMs: number;
  size: number;
  value: unknown;
}

@Injectable()
export class ValueCache {
  private readonly entries = new Map<string, CacheEntry>();

  /**
   * 读缓存：stat 与缓存条目一致（mtime + size 未变）→ 命中返回缓存值；
   * 否则执行 load 重新求值并登记。
   */
  get<T>(absPath: string, load: () => T): T {
    const stat = fs.statSync(absPath);
    const hit = this.entries.get(absPath);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
      return hit.value as T;
    }
    const value = load();
    this.entries.set(absPath, { mtimeMs: stat.mtimeMs, size: stat.size, value });
    return value;
  }

  /** 失效指定文件缓存（写管线第 8 步调用） */
  invalidate(absPath: string): void {
    this.entries.delete(absPath);
  }

  /** 当前缓存条目数（测试/观测用） */
  get size(): number {
    return this.entries.size;
  }
}
