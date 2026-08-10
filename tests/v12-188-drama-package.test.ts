/**
 * v12.188 — Drama Center 打包:定价纯函数 + 端点接线锁。
 */
import { describe, it, expect } from 'vitest';
import { suggestPricing, buildDramaPackage } from '@/lib/drama-package';
import fs from 'fs';

describe('v12.188 · Drama 打包', () => {
  it('定价:前 3 集免费,付费集按时长档位', () => {
    const p = suggestPricing([
      { episodeNumber: 1, title: 'a', videoUrl: 'u', durationSec: 60 },
      { episodeNumber: 4, title: 'b', videoUrl: 'u', durationSec: 130 },
      { episodeNumber: 5, title: 'c', videoUrl: 'u', durationSec: 45 },
    ]);
    expect(p[0]).toEqual({ episodeNumber: 1, unlock: 'free', coins: 0 });
    expect(p[1]).toEqual({ episodeNumber: 4, unlock: 'coins', coins: 60 });
    expect(p[2].coins).toBe(30);
  });
  it('打包:按集号排序 + 上传指引 + AI 声明', () => {
    const pkg = buildDramaPackage({ seriesTitle: 'T', episodes: [{ episodeNumber: 2, title: 'b', videoUrl: 'u2' }, { episodeNumber: 1, title: 'a', videoUrl: 'u1' }] });
    expect(pkg.episodes[0].episodeNumber).toBe(1);
    expect(pkg.uploadGuide.join('')).toContain('AI-generated');
    expect(pkg.platform).toBe('tiktok-drama-center');
  });
  it('接线锁:端点 auth+completed 过滤+封面+时长探测', () => {
    const r = fs.readFileSync('app/api/series/[id]/drama-package/route.ts', 'utf-8');
    expect(r).toContain("e.status === 'completed'");
    expect(r).toContain('season_cover');
    expect(r).toContain('probeMediaFull');
  });
});
