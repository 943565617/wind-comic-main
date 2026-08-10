/**
 * v12.118 — 英文广告链:英文 CTA 补句/信号识别 + 英文合规红线。
 */
import { describe, it, expect } from 'vitest';
import { ensureCtaEnding } from '@/lib/end-card';
import { sanitizeAdCopy, checkAdCompliance } from '@/lib/ad-compliance';

describe('v12.118 · 英文 CTA', () => {
  it('英文片补英文 CTA,句号衔接', () => {
    const shots = [{ dialogue: 'The sound is unreal' }];
    const r = ensureCtaEnding(shots, 'AeroBuds Pro', 'en');
    expect(r.added).toBe(true);
    expect(shots[0].dialogue).toBe('The sound is unreal. Love it? Try AeroBuds Pro — your turn to be surprised.');
  });
  it('英文 CTA 信号已存在则不重复补(中英信号都认)', () => {
    expect(ensureCtaEnding([{ dialogue: 'Grab yours today!' }], '', 'en').added).toBe(false);
    expect(ensureCtaEnding([{ dialogue: '点击链接入手' }], '', 'en').added).toBe(false);
  });
  it('中文行为回归不变', () => {
    const shots = [{ dialogue: '音质太顶了' }];
    const r = ensureCtaEnding(shots, '声澎耳机');
    expect(r.added).toBe(true);
    expect(shots[0].dialogue).toContain('心动就试试声澎耳机');
  });
});

describe('v12.118 · 英文合规红线', () => {
  it('cure/miracle/guaranteed results/100% effective/#1/risk-free 全拦', () => {
    const { text, hits } = sanitizeAdCopy('This miracle serum cures acne, 100% effective, guaranteed results, risk-free, our #1 pick');
    expect(text).toBe('This remarkable serum helps with acne, highly effective, real results, easy to try, our top-rated pick');
    expect(new Set(hits.map((h) => h.category))).toEqual(new Set(['英文红线']));
  });
  it('大小写不敏感;普通词不误伤', () => {
    expect(sanitizeAdCopy('CURE-all MIRACLE').hits.length).toBeGreaterThan(0);
    expect(checkAdCompliance('secure procurement of curedmeat').length).toBe(0);
  });
});
