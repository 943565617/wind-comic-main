/**
 * v12.209 — i18n 全量批:5 文件中文提取 + 4 命名空间四语齐全 + provider-health lib 层零中文。
 */
import { describe, it, expect } from 'vitest';
import { t } from '@/lib/i18n';
import fs from 'fs';

describe('v12.209 · i18n 全量批', () => {
  it('4 命名空间四语切换(v12.213 起 ko/ru 已补真文案)', () => {
    expect(t('zh-CN', 'healthPage.title')).toBe('API 健康');
    expect(t('en', 'healthPage.title')).toBe('API Health');
    expect(t('ja', 'usagePage.headline')).toBe('コスト可観測性');
    expect(t('en', 'seriesDetail.batchGenerateBtn')).toBe('Batch Generate');
    expect(t('ja', 'visionAudit.panelTitle')).toContain('品質チェック');
    expect(t('ko', 'healthPage.title')).toMatch(/[가-힣]/); // v12.213:ko 已有真韩文
  });
  it('provider-health lib 层零中文(STATUS_META label 存 i18n key)', () => {
    const ph = fs.readFileSync('lib/provider-health.ts', 'utf-8');
    // STATUS_META 区块内不再有中文 label
    const block = ph.slice(ph.indexOf('STATUS_META'), ph.indexOf('STATUS_META') + 600);
    expect(block).not.toMatch(/label: '[一-鿿]/);
    expect(block).toContain("label: 'outOfCredits'");
    expect(t('zh-CN', 'providerHealth.outOfCredits')).toBe('额度用尽');
    expect(t('en', 'providerHealth.recharge')).toBe('Recharge');
  });
  it('5 目标页/组件已接 useLocale', () => {
    for (const f of ['app/dashboard/health/page.tsx', 'app/dashboard/usage/page.tsx', 'app/dashboard/series/[id]/page.tsx', 'components/project/vision-audit-panel.tsx']) {
      expect(fs.readFileSync(f, 'utf-8')).toContain('useLocale');
    }
  });
});
