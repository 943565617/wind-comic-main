/**
 * v12.184 — BGM 卡点治理:BPM 网格纯函数 + fallback 语义 + recompose 自定义 BGM。
 */
import { describe, it, expect } from 'vitest';
import { beatGridFromBpm } from '@/lib/beat-detect';
import fs from 'fs';

describe('v12.184 · BPM 网格', () => {
  it('等间隔网格:96bpm=0.625s 步进;相位偏移;坏输入空数组', () => {
    const g = beatGridFromBpm(96, 5);
    expect(g[0]).toBeCloseTo(0.625, 2);
    expect(g[1]).toBeCloseTo(1.25, 2);
    expect(g.length).toBe(8);
    expect(beatGridFromBpm(120, 2, 0.5)[0]).toBeCloseTo(0.5, 2);
    expect(beatGridFromBpm(0, 10)).toEqual([]);
    expect(beatGridFromBpm(96, -1)).toEqual([]);
  });
  it('接线锁:composer 用 fallback 版(真拍点稀疏→网格);recompose 收 bgmUrl', () => {
    const c = fs.readFileSync('services/video-composer.ts', 'utf-8');
    expect(c).toContain('detectBeatsWithFallback(localMusicPath');
    expect(c).toContain('BPM 网格兜底');
    const r = fs.readFileSync('app/api/projects/[id]/recompose/route.ts', 'utf-8');
    expect(r).toContain('body?.bgmUrl');
    expect(r).toContain('customBgm ||');
  });
});
