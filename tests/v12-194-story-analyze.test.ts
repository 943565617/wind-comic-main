/**
 * v12.194 — AI 问书:三段采样纯函数 + prompt schema + 端点/UI 接线锁。
 */
import { describe, it, expect } from 'vitest';
import { sampleLongText, buildAnalyzePrompt } from '@/lib/story-analyze';
import fs from 'fs';

describe('v12.194 · AI 问书', () => {
  it('≤80K 原样;超长取头40K/中20K/尾20K并标记', () => {
    const short = sampleLongText('x'.repeat(1000));
    expect(short.sampledOnly).toBe(false);
    const long = sampleLongText('a'.repeat(50000) + 'b'.repeat(50000) + 'c'.repeat(50000));
    expect(long.sampledOnly).toBe(true);
    expect(long.sample).toContain('【开头节选】');
    expect(long.sample).toContain('【中段节选】');
    expect(long.sample).toContain('【结尾节选】');
    expect(long.sample.length).toBeLessThan(90000);
    expect(long.sample.endsWith('c'.repeat(100).slice(0, 100))).toBe(true);
  });
  it('prompt:人物/设定/高光三段 schema + 数量上限 + 原文语言', () => {
    const p = buildAnalyzePrompt();
    expect(p).toContain('characters');
    expect(p).toContain('highlights');
    expect(p).toContain('≤8');
    expect(p).toContain('原文语言');
  });
  it('接线锁:端点(auth+长度界+采样标注)与 story-intake 按钮', () => {
    const r = fs.readFileSync('app/api/story-intake/analyze/route.ts', 'utf-8');
    expect(r).toContain('sampleLongText');
    expect(r).toContain('2_000_000');
    expect(r).toContain('profile.sampledOnly = sampledOnly');
    const ui = fs.readFileSync('app/dashboard/story-intake/page.tsx', 'utf-8');
    expect(ui).toContain('AI 问书');
    expect(ui).toContain('story-intake/analyze');
  });
});
