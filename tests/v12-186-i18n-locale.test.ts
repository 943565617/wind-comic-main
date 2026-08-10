/**
 * v12.186 — UI i18n 扩语种:ko/ru 就位 + 未知回退 en + en 兜底字典。
 */
import { describe, it, expect } from 'vitest';
import { normalizeLocale, getTranslations, LOCALES } from '@/lib/i18n';

describe('v12.186 · i18n locale', () => {
  it('ko/ru 识别;未知语言回退 en(俄语用户不再看全中文);空输入保持 zh-CN', () => {
    expect(normalizeLocale('ko-KR')).toBe('ko');
    expect(normalizeLocale('ru')).toBe('ru');
    expect(normalizeLocale('fr-FR')).toBe('en');   // 未知 → en(原 zh-CN)
    expect(normalizeLocale('')).toBe('zh-CN');
    expect(normalizeLocale('zh-HK')).toBe('zh-TW');
    expect(LOCALES).toContain('ko');
  });
  it('ko/ru 取词以 en 兜底(非 zh),结构完整无 undefined', () => {
    const ko = getTranslations('ko');
    const en = getTranslations('en');
    expect(ko.common.save).toBe(en.common.save);
    expect(typeof ko.common.create).toBe('string');
  });
});
