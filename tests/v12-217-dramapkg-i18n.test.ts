/**
 * v12.217 — drama-package i18n 欠账清偿(v12.210 承诺):13 键六语 + 组件接 t.。
 */
import { describe, it, expect } from 'vitest';
import { t } from '@/lib/i18n';
import fs from 'fs';

describe('v12.217 · drama-package i18n', () => {
  it('13 键六语齐全(抽查各语种特征)', () => {
    expect(t('zh-CN', 'seriesDetail.dramaPackageBtn')).toBe('📦 出海打包');
    expect(t('en', 'seriesDetail.dramaPackageBtn')).toContain('Export Package');
    expect(t('zh-TW', 'seriesDetail.dramaPackageDownload')).toBe('下載 JSON');
    expect(t('ja', 'seriesDetail.dramaPackageGuideTitle')).toContain('アップロード');
    expect(t('ko', 'seriesDetail.dramaPackageEpFree')).toBe('무료');
    expect(t('ru', 'seriesDetail.dramaPackageEpFree')).toBe('Бесплатно');
  });
  it('插值占位符保留({lang}/{n}/{coins})', () => {
    for (const loc of ['zh-CN', 'en', 'ko', 'ru'] as const) {
      expect(t(loc, 'seriesDetail.dramaPackageLangEpisodes')).toContain('{n}');
      expect(t(loc, 'seriesDetail.dramaPackageEpCoins')).toContain('{coins}');
    }
  });
  it('组件已接 useLocale,UI 中文字面量清零', () => {
    const c = fs.readFileSync('components/project/drama-package-button.tsx', 'utf-8');
    expect(c).toContain('useLocale');
    expect(c).toContain('t.seriesDetail.dramaPackageBtn');
    // 逐行扫:非注释行不得含中文字符串字面量
    const bad = c.split('\n').filter((ln) => !/^\s*(\*|\/\/|\/\*|\{\/\*)/.test(ln) && /['"`][^'"`]*[一-鿿]/.test(ln));
    expect(bad).toEqual([]);
  });
});
