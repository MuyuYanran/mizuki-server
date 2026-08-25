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
    });
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
});
