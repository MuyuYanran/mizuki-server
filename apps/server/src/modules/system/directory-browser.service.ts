/**
 * [U3-P3/K1] system/directory-browser.service — 目录浏览（初始化向导点选器后端）
 * [职责] 枚举本机目录，供初始化向导逐级点选 Mizuki 项目根：
 *   - 无 path → 根列表（Windows 枚举存在的盘符；POSIX 固定 '/'）；
 *   - 有 path → 该目录下的**子目录**数组 [{name, isMizuki}] + parent 路径；
 *   - 仅目录不返回文件；跳过隐藏目录（. / $ 前缀）与符号链接目录（防循环防越界）；
 *   - 单次上限 200 条，超出截断并附 truncated 标志；
 *   - isMizuki 为**轻量**判据（存在 package.json 或 astro.config.mjs）——
 *     完整检测仍走既有 POST /system/detect 端点。
 * [状态] ACTIVE
 *
 * 安全边界：
 *   - 路径必须为**绝对路径**（相对路径/相对段注入 → 400）；
 *   - 只返回**目录名**（不返回绝对路径以外的文件内容，也不枚举文件）；
 *   - 错误文案不回显用户提交的绝对路径原文（AGENTS §6 不泄内部信息）；
 *   - 端点为 @Public（向导是 pre-auth 流程），但带**未初始化门**：
 *     系统已初始化 → 409（仅向导期可用）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

/** 单次返回条数上限（R2-10 规格：单次上限 200 条） */
export const BROWSE_MAX_ITEMS = 200;

/** 目录项 */
export interface BrowseDirItem {
  /** 目录名（仅名，不含父路径） */
  name: string;
  /** 轻量判据：目录下存在 package.json 或 astro.config.mjs */
  isMizuki: boolean;
}

/** 目录浏览结果 */
export interface BrowseDirsResult {
  /** 上级目录绝对路径；根层为 null */
  parent: string | null;
  /** 子目录列表（有序） */
  items: BrowseDirItem[];
  /** 是否因超过上限而截断 */
  truncated: boolean;
}

@Injectable()
export class DirectoryBrowserService {
  /**
   * 列出目录内容。
   * @param rawPath 原始路径入参（未提供 → 根层）
   */
  browse(rawPath?: string): BrowseDirsResult {
    if (rawPath === undefined || rawPath.trim() === '') {
      return this.browseRoot();
    }
    const requested = rawPath.trim();
    if (!path.isAbsolute(requested)) {
      // 相对路径/相对段注入一律拒绝（不回显原文）
      throw new BadRequestException('path 必须为绝对路径');
    }
    const resolved = path.resolve(requested);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      throw new NotFoundException('目录不存在');
    }
    if (!stat.isDirectory()) {
      throw new NotFoundException('目标不是目录');
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(resolved, { withFileTypes: true });
    } catch {
      throw new NotFoundException('目录不可读');
    }

    const items: BrowseDirItem[] = [];
    let truncated = false;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        continue; // 仅目录；符号链接目录跳过（防循环防越界）
      }
      if (entry.name.startsWith('.') || entry.name.startsWith('$')) {
        continue; // 隐藏目录跳过
      }
      if (items.length >= BROWSE_MAX_ITEMS) {
        truncated = true;
        break;
      }
      items.push({
        name: entry.name,
        isMizuki: this.isMizukiCandidate(path.join(resolved, entry.name)),
      });
    }
    items.sort((a, b) => a.name.localeCompare(b.name));

    const parentDir = path.dirname(resolved);
    const parent = parentDir === resolved ? null : parentDir;
    return { parent, items, truncated };
  }

  /** 根层：Windows 枚举存在的盘符；POSIX 固定 '/' */
  private browseRoot(): BrowseDirsResult {
    if (process.platform !== 'win32') {
      return { parent: null, items: [{ name: '/', isMizuki: false }], truncated: false };
    }
    const items: BrowseDirItem[] = [];
    for (let code = 'A'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`;
      if (fs.existsSync(drive)) {
        items.push({ name: drive, isMizuki: false });
      }
    }
    return { parent: null, items, truncated: false };
  }

  /**
   * 轻量 isMizuki 判据（R2-2 逐字）：目录下存在 package.json 或 astro.config.mjs。
   * 完整四项检测（astro 依赖 / src/data / posts 目录）仍归既有 detect 端点。
   */
  private isMizukiCandidate(dirAbs: string): boolean {
    try {
      return (
        fs.existsSync(path.join(dirAbs, 'package.json')) ||
        fs.existsSync(path.join(dirAbs, 'astro.config.mjs'))
      );
    } catch {
      return false;
    }
  }
}
