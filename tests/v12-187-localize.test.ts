/**
 * v12.187 — 一键多语版:localize 端点结构锁(翻译→校验→资产→apply 链)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.187 · 一键多语版', () => {
  it('localize:auth+归属、非中文校验、结构/语种双校验失败原稿不动、多语资产、apply 备份', () => {
    const r = fs.readFileSync('app/api/projects/[id]/localize/route.ts', 'utf-8');
    expect(r).toContain('getOwnedProject');
    expect(r).toContain("lang === 'zh'");
    expect(r).toContain('cand.shots.length === script.shots.length'); // 提档重试版的结构校验
    expect(r).toContain('needsLanguageFix(translated, lang)');
    expect(r).toContain('script-${lang}');
    expect(r).toContain("'script-original'");
    expect(r).toContain('regenVoiceover');
  });
  it('recompose:regenVoiceover TTS 语种可传(默认 zh 保旧)', () => {
    const r = fs.readFileSync('app/api/projects/[id]/recompose/route.ts', 'utf-8');
    expect(r).toContain("normalizeLanguage(String(body?.language || 'zh')");
  });
});
