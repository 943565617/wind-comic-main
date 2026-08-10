/**
 * v12.213 — Kling 4K(仅v3) + ko/ru 全量文案包。
 */
import { describe, it, expect } from 'vitest';
import { t } from '@/lib/i18n';
import fs from 'fs';

describe('v12.213 · 4K + ko/ru', () => {
  it('4K:render4K 仅 kling-v3 走 mode:4k,与运镜/音效互斥', () => {
    const k = fs.readFileSync('services/kling.service.ts', 'utf-8');
    expect(k).toContain("options?.render4K === true && model.startsWith('kling-v3')");
    expect(k).toContain("mode: want4K ? '4k'");
    expect(k).toContain('&& !want4K'); // enable_audio 与 4K 互斥
  });
  it('ko/ru 真文案(非 en 兜底)', () => {
    expect(t('ko', 'nav.home')).toBe('홈');
    expect(t('ko', 'healthPage.title')).toMatch(/[가-힣]/); // 韩文
    expect(t('ru', 'nav.home')).toBe('Главная');
    expect(t('ru', 'providerHealth.outOfCredits')).toBe('Квота исчерпана');
    // 占位符保留
    expect(t('ko', 'seriesDetail.statTotal')).toContain('{n}');
    expect(t('ru', 'seriesDetail.statTotal')).toContain('{n}');
  });
});
