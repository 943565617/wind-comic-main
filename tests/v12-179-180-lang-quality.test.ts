/**
 * v12.179/180 — 口型语种诚实降级 + 字幕字体跨平台。
 */
import { describe, it, expect } from 'vitest';
import { lipsyncLangCode } from '@/lib/language-detect';
import { fontForLanguage, buildSubtitlesFilter } from '@/lib/subtitle-burn';
import fs from 'fs';

describe('v12.179 · 口型语种', () => {
  it('ko/ru/ja → none(错口型比无口型更伤);zh/en 保留', () => {
    expect(lipsyncLangCode('ko')).toBe('none');
    expect(lipsyncLangCode('ru')).toBe('none');
    expect(lipsyncLangCode('ja')).toBe('none'); // v12.196:日语音素差距不亚于韩俄,跟进降级
    expect(lipsyncLangCode('zh')).toBe('zh');
    expect(lipsyncLangCode('en')).toBe('en');
  });
  it('接线锁:orchestrator none 跳过口型', () => {
    const o = (fs.readFileSync('services/hybrid-orchestrator.ts','utf-8')+fs.readFileSync('services/agents/writer-agent.ts','utf-8')+fs.readFileSync('services/agents/editor-agent.ts','utf-8'));
    expect(o).toContain("lsLang === 'none'");
    expect(o).toContain('跳过口型');
  });
});

describe('v12.180 · 字幕字体', () => {
  it('SUBTITLE_FONT env 最优先;语种映射按平台;非 darwin 用 Noto 系', () => {
    expect(fontForLanguage('ko', 'PingFang SC', { SUBTITLE_FONT: 'MyFont' })).toBe('MyFont');
    const linuxKo = fontForLanguage('ko', 'PingFang SC', {});
    expect([ 'Noto Sans KR', 'Apple SD Gothic Neo' ]).toContain(linuxKo!);
    const zhF = fontForLanguage('zh', 'PingFang SC', {});
    expect(['PingFang SC', 'Noto Sans CJK SC']).toContain(zhF!);
  });
  it('CI 等价:Linux 平台语义(darwin 本地跑不出的分支)', () => {
    expect(fontForLanguage(undefined, 'Arial', {}, 'linux')).toBeNull();      // 未指定语种不覆盖 —— CI 抓到的真 bug
    expect(fontForLanguage('zh', 'PingFang SC', {}, 'linux')).toBe('Noto Sans CJK SC');
    expect(fontForLanguage('ko', 'PingFang SC', {}, 'linux')).toBe('Noto Sans KR');
    expect(fontForLanguage('ru', 'PingFang SC', {}, 'linux')).toBe('DejaVu Sans');
    expect(fontForLanguage(undefined, 'Arial', {}, 'darwin')).toBeNull();
  });
  it('buildSubtitlesFilter 带 lang 参数换字体;显式 override 优先', () => {
    const ko = buildSubtitlesFilter('/tmp/a.srt', 'douyin', {}, 'ko');
    expect(ko).toMatch(/FontName=(Noto Sans KR|Apple SD Gothic Neo)/);
    const ov = buildSubtitlesFilter('/tmp/a.srt', 'douyin', { fontName: 'Custom' }, 'ko');
    expect(ov).toContain('FontName=Custom');
  });
});
