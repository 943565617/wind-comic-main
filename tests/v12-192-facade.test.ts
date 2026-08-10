/**
 * v12.192 — 门面治本:README 版本同步脚本 + 死代码清除 + SES 响亮告警。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.192 · 门面治本', () => {
  it('postversion 钩子 + 同步脚本存在;README H1 与 package.json 一致', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    expect(pkg.scripts.postversion).toContain('sync-readme-version');
    expect(fs.existsSync('scripts/sync-readme-version.mjs')).toBe(true);
    const readme = fs.readFileSync('README.md', 'utf-8');
    const m = readme.match(/<sub><sup>(v[\d.]+)<\/sup><\/sub>/);
    expect(m![1]).toBe('v' + pkg.version.replace(/\.0$/, ''));
  });
  it('performance.ts 死代码已删;SES 分支不再静默(console.error + default 补齐)', () => {
    expect(fs.existsSync('lib/performance.ts')).toBe(false);
    const es = fs.readFileSync('lib/email-sender.ts', 'utf-8');
    expect(es).toContain('console.error(`[email-sender]');
    expect(es).toContain('default: {');
  });
});
