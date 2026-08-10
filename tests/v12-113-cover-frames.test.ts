/**
 * v12.113 — 成片抽帧封面精选:采样点(避 hook/CTA 卡)+ 排序(质量为主/烧字轻罚/未打分垫底)。
 */
import { describe, it, expect } from 'vitest';
import { pickFrameTimes, rankCoverFrames } from '@/lib/cover-frames';

describe('v12.113 · 封面抽帧', () => {
  it('pickFrameTimes:12%–80% 均匀采样,0.1s 精度', () => {
    const t = pickFrameTimes(100, 4);
    expect(t).toEqual([12, 34.7, 57.3, 80]);
    expect(pickFrameTimes(0)).toEqual([]);
    expect(pickFrameTimes(10, 1)).toEqual([5]);
    expect(pickFrameTimes(60, 99).length).toBe(8); // 上限 8
  });

  it('rankCoverFrames:质量降序,烧字 -1,未打分垫底', () => {
    const ranked = rankCoverFrames([
      { url: 'a', timeSec: 1, quality: 7, hasBakedText: true, scored: true },   // 6
      { url: 'b', timeSec: 2, quality: 0, hasBakedText: false, scored: false }, // -1
      { url: 'c', timeSec: 3, quality: 6.5, hasBakedText: false, scored: true },// 6.5
    ]);
    expect(ranked.map((f) => f.url)).toEqual(['c', 'a', 'b']);
  });
});
