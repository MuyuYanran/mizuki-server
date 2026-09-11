/**
 * [Phase4-D1] T5 回归锚（编辑器包装层，服务端可自动化部分）：
 * ① 转义注入面锚（T5 决策表）：我方向 Vditor 注入的文案（包装层 placeholder 缺省、
 *    toolbar 名单、编辑页/关于页传入文案）不含未解码 HTML 实体——缺陷二「提示文本
 *    HTML 实体未解码」的我方注入面排除锚。T1.2 结论：转义链位于 vditor 上游
 *    locale/模板（level-2 innerHTML `&lt;` 路径与 setAttribute raw 路径并存），
 *    我方零自定义 locale、零自定义 tip。
 * ② 附加锚（B3.5 自托管同步义务，报告记附加）：包装层 VDITOR_VERSION 常量与
 *    apps/web 依赖声明一致、自托管 /vditor/<版本>/dist/index.js 在位——防升级漂移
 *    （升级不同步即 lute/i18n 404，缺陷④同类故障面）。
 *
 * 空白框锚（容器修复形态）按 T5 决策表降级手动：自动化需真实浏览器 DOM
 * （服务端 vitest 无浏览器环境），走查取证见 SESSIONS Phase4-D1 报告 §手动走查。
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = path.resolve(__dirname, '../../web');
const WRAPPER = path.join(WEB_ROOT, 'src/lib/editors/VditorEditor.vue');
const POST_PAGE = path.join(WEB_ROOT, 'src/views/posts/PostEditPage.vue');
const ABOUT_PAGE = path.join(WEB_ROOT, 'src/views/posts/AboutEditPage.vue');

/** 用户可见文案的实体字面量（未解码形态）匹配 */
const HTML_ENTITY = /&[a-zA-Z]{2,8};|&#\d{1,5};/g;

describe('Phase4-D1 VditorEditor 包装层回归锚', () => {
  const wrapperSrc = fs.readFileSync(WRAPPER, 'utf8');

  it('① 转义注入面锚：我方注入文案不含未解码 HTML 实体', () => {
    // 包装层 + 两个使用页（placeholder 等文案的唯一注入面）
    for (const file of [WRAPPER, POST_PAGE, ABOUT_PAGE]) {
      const src = fs.readFileSync(file, 'utf8');
      const hits = src.match(HTML_ENTITY) ?? [];
      expect(hits, `${path.basename(file)} 出现实体字面量`).toEqual([]);
    }
    // toolbar 名单仅含按钮名（无自定义 tip 文案）
    expect(wrapperSrc).toContain("const TOOLBAR = [");
    expect(wrapperSrc).not.toMatch(/tip\s*:/);
    // 无 locale 覆盖注入（lang 固定为 vditor 内建 zh_CN）
    expect(wrapperSrc).toContain("lang: 'zh_CN'");
  });

  it('② 附加锚：VDITOR_VERSION 与依赖声明一致且自托管产物在位', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(WEB_ROOT, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    const declared = pkg.dependencies['vditor'];
    expect(declared).toBeDefined();

    const match = /const VDITOR_VERSION = '([^']+)'/.exec(wrapperSrc);
    expect(match).not.toBeNull();
    const version = match![1];
    // 声明形如 ^3.11.3（patch 级升级许可，ADR-021）；主次版本须与常量一致
    expect(declared.replace(/^[~^]/, '')).toBe(version);

    const selfHosted = path.join(WEB_ROOT, 'public/vditor', version, 'dist/index.js');
    expect(fs.existsSync(selfHosted), `自托管产物缺失: ${selfHosted}`).toBe(true);
  });
});
