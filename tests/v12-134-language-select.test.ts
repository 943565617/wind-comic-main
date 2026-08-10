/**
 * v12.134 — issue #2 多语种剧本:normalizeLanguage / 注册表 / TTS 降级 / CTA 语种。
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeLanguage, detectLanguage, ttsLangCode, lipsyncLangCode, ttsReliable,
  languageDisplayName, listSupportedLanguages, isSupportedLanguage, SUPPORTED_LANGUAGES,
} from '@/lib/language-detect';
import { ensureCtaEnding } from '@/lib/end-card';

describe('v12.134 · 语种规范化', () => {
  it('code / 别名 / 母语名 都归一', () => {
    expect(normalizeLanguage('ru')).toBe('ru');
    expect(normalizeLanguage('Russian')).toBe('ru');
    expect(normalizeLanguage('俄语')).toBe('ru');
    expect(normalizeLanguage('Русский')).toBe('ru');
    expect(normalizeLanguage('EN-US')).toBe('en');
    expect(normalizeLanguage('日本語')).toBe('ja');
  });
  it("'auto'/空/未知 → 回退自动检测(按 fallbackText)", () => {
    expect(normalizeLanguage('auto', 'Hello world')).toBe('en');
    expect(normalizeLanguage('', '你好世界啊')).toBe('zh');
    expect(normalizeLanguage('klingon', 'plain english text here')).toBe('en');
    expect(normalizeLanguage(null, null)).toBe('zh');
  });
  it('detectLanguage 行为回归不变(仍只 zh/en)', () => {
    expect(detectLanguage('纯中文')).toBe('zh');
    expect(detectLanguage('pure english')).toBe('en');
    expect(detectLanguage('')).toBe('zh');
  });
});

describe('v12.134 · 语种元数据 + 降级', () => {
  it('ttsLangCode / lipsyncLangCode:非 zh/en 语种 lipsync 退回 en 近似', () => {
    expect(ttsLangCode('ru')).toBe('ru-RU');
    expect(lipsyncLangCode('ru')).toBe('none'); // v12.179:音素差异过大改诚实降级(跳过口型)
    expect(lipsyncLangCode('zh')).toBe('zh');
    expect(ttsLangCode('ja')).toBe('ja-JP');
  });
  it('ttsReliable + 显示名 + 列表', () => {
    expect(ttsReliable('ru')).toBe(true);
    expect(languageDisplayName('ru')).toBe('Русский');
    expect(isSupportedLanguage('ru')).toBe(true);
    expect(isSupportedLanguage('xx')).toBe(false);
    expect(listSupportedLanguages().length).toBe(Object.keys(SUPPORTED_LANGUAGES).length);
    expect(listSupportedLanguages().find((l) => l.code === 'zh')?.nativeName).toBe('简体中文');
  });
});

describe('v12.134 · CTA 语种(非中文走英文兜底,不塞中文)', () => {
  it('俄语剧本补 CTA → 走英文兜底句,不注入中文', () => {
    const shots = [{ dialogue: 'Это потрясающе' }];
    const r = ensureCtaEnding(shots, 'AeroPods', 'ru');
    expect(r.added).toBe(true);
    expect(shots[0].dialogue).toContain('Love it?');
    expect(/[一-鿿]/.test(shots[0].dialogue!)).toBe(false); // 无中文
  });
  it('中文仍中文 CTA(回归)', () => {
    const shots = [{ dialogue: '音质太顶了' }];
    ensureCtaEnding(shots, '声澎耳机', 'zh');
    expect(shots[0].dialogue).toContain('心动就试试声澎耳机');
  });
});
