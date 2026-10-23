import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadAppConfig } from '../../src/config/app-config';

describe('P0b config.json zod 校验加载（§6.2）', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mizuki-cfg-'));
  });

  it('文件不存在 → 返回默认值，不抛错', () => {
    const config = loadAppConfig(path.join(dir, 'config.json'));
    expect(config).toEqual({
      mizukiRoot: '',
      mode: 'manage',
      backupDir: 'data/backups',
      uploadLimitMb: 10,
      swagger: true, // [B2/裁决 6] 新增默认字段
      corsOrigins: [], // [Wave-2/B3] 纳入 schema 的 CORS 扩展白名单（原为被 strip 的死代码）
      tasks: [], // [U3-P3/K5] 任务模板默认空数组
      taskEnv: {}, // [U3-P4a/K1] 任务级环境变量默认空表
      // [U4-AI1/K1] AI 配置默认段（缺键 → 逐字段取默认；key 只可能出现在 profiles[].apiKey）
      ai: {
        enabled: false,
        profiles: [
          {
            id: 'deepseek',
            name: 'DeepSeek',
            baseUrl: 'https://api.deepseek.com/v1',
            model: 'deepseek-flash',
          },
        ],
        proxy: { mode: 'system' },
        allowPrivateNetwork: false,
        maxOutputTokens: 1024,
        temperature: 0.7,
        timeoutMs: 30_000,
      },
    });
  });

  it('合法文件 → 返回解析值', () => {
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        mizukiRoot: 'D:/mizuki',
        mode: 'additive',
        backupDir: 'data/my-backups',
        uploadLimitMb: 5,
      }),
      'utf8',
    );
    const config = loadAppConfig(file);
    expect(config).toEqual({
      mizukiRoot: 'D:/mizuki',
      mode: 'additive',
      backupDir: 'data/my-backups',
      uploadLimitMb: 5,
      swagger: true, // [B2/裁决 6] 缺省补默认 true
      corsOrigins: [], // [Wave-2/B3] 缺省补默认空数组
      tasks: [], // [U3-P3/K5] 缺省补默认空数组
      taskEnv: {}, // [U3-P4a/K1] 缺省补默认空表（新键零迁移）
      // [U4-AI1/K1] 缺省补 AI 默认段（DeepSeek + deepseek-flash + system 代理）
      ai: {
        enabled: false,
        profiles: [
          {
            id: 'deepseek',
            name: 'DeepSeek',
            baseUrl: 'https://api.deepseek.com/v1',
            model: 'deepseek-flash',
          },
        ],
        proxy: { mode: 'system' },
        allowPrivateNetwork: false,
        maxOutputTokens: 1024,
        temperature: 0.7,
        timeoutMs: 30_000,
      },
    });
  });

  it('任务模板合法值 → 解析通过（[U3-P3/K5] 命名快捷预设）', () => {
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        tasks: [{ name: '构建产物', task: 'build', description: '出静态产物' }],
      }),
      'utf8',
    );
    const config = loadAppConfig(file);
    expect(config.tasks).toEqual([
      { name: '构建产物', task: 'build', description: '出静态产物' },
    ]);
  });

  it('任务模板越界键（cmd/args/shell）→ 抛出含字段路径的错误（[U3-P3/K5] 再裁 B）', () => {
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ tasks: [{ name: '越界', task: 'build', cmd: 'powershell' }] }),
      'utf8',
    );
    expect(() => loadAppConfig(file)).toThrow(/tasks/);
  });

  it('任务模板 task 非白名单值 → 抛出含字段路径的错误', () => {
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ tasks: [{ name: '越界', task: 'rm' }] }),
      'utf8',
    );
    expect(() => loadAppConfig(file)).toThrow(/tasks/);
  });

  it('非法值（uploadLimitMb: "abc"）→ 抛出含字段路径的错误', () => {
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, JSON.stringify({ uploadLimitMb: 'abc' }), 'utf8');
    expect(() => loadAppConfig(file)).toThrow(/uploadLimitMb/);
  });

  it('非法 mode → 抛出含字段路径的错误', () => {
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, JSON.stringify({ mode: 'hijack' }), 'utf8');
    expect(() => loadAppConfig(file)).toThrow(/mode/);
  });

  // ── [U4-AI1/K1] ai 段进 schema（防 strip）──

  it('默认配置含 ai 段（未声明键会被 strip，故必须显式入 schema）', () => {
    const config = loadAppConfig(path.join(dir, 'config.json'));
    expect(config.ai).toBeDefined();
    expect(config.ai.enabled).toBe(false);
    expect(config.ai.profiles).toHaveLength(1);
    expect(config.ai.profiles[0]?.model).toBe('deepseek-flash');
    expect(config.ai.proxy).toEqual({ mode: 'system' });
  });

  it('读到 ai.baseUrl / apiKey 不被丢弃（strip 防回归）', () => {
    const file = path.join(dir, 'config.json');
    const secret = 'sk-config-file-secret-0001';
    fs.writeFileSync(
      file,
      JSON.stringify({
        ai: {
          enabled: true,
          activeProfileId: 'lm',
          profiles: [
            {
              id: 'lm',
              name: 'Local',
              baseUrl: 'https://example.com/v1',
              model: 'm1',
              apiKey: secret,
            },
          ],
          proxy: { mode: 'custom', url: 'http://127.0.0.1:7890' },
          allowPrivateNetwork: true,
          maxOutputTokens: 2048,
          temperature: 0.2,
          timeoutMs: 5000,
        },
      }),
      'utf8',
    );
    const config = loadAppConfig(file);
    expect(config.ai.enabled).toBe(true);
    expect(config.ai.activeProfileId).toBe('lm');
    expect(config.ai.profiles[0]?.baseUrl).toBe('https://example.com/v1');
    expect(config.ai.profiles[0]?.apiKey).toBe(secret);
    expect(config.ai.proxy).toEqual({ mode: 'custom', url: 'http://127.0.0.1:7890' });
    expect(config.ai.allowPrivateNetwork).toBe(true);
    expect(config.ai.maxOutputTokens).toBe(2048);
    expect(config.ai.temperature).toBe(0.2);
    expect(config.ai.timeoutMs).toBe(5000);
  });
});
