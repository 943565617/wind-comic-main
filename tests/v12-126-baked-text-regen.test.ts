/**
 * v12.126 — 烤字镜自愈:去字提示纯函数 + 重生事件进摘要(轻扣分,非降级)。
 */
import { describe, it, expect } from 'vitest';
import { buildNoTextPrompt } from '@/lib/broll';
import { summarizeQualityLedger } from '@/lib/quality-report';

describe('v12.126 · 去字提示', () => {
  it('追加负向去字指令,幂等', () => {
    const p = buildNoTextPrompt('A woman sips coffee, 50mm, cinematic');
    expect(p).toContain('no on-screen text');
    expect(buildNoTextPrompt(p)).toBe(p);            // 已含不重复追加
    expect(buildNoTextPrompt('')).toContain('no on-screen text'); // 空 prompt 也给指令
  });
});

describe('v12.126 · 重生事件记账', () => {
  it('video-baked-regen 进摘要,按重试类轻扣 5,不算降级镜', () => {
    const r = summarizeQualityLedger([{ shot: 3, kind: 'video-baked-regen', detail: '烤字重生一次已清除' }]);
    expect(r.summary).toContain('1 镜烤字重生已消除');
    expect(r.healthScore).toBe(95);           // 100-5
    expect(r.degradedShots).toEqual([]);       // 自愈成功不算降级
    expect(r.shotReasons).toEqual({ 3: ['video-baked-regen'] });
  });
  it('对比:仍烤字(video-baked-text)不算降级但也不进 degraded,healthScore 同扣 5', () => {
    const r = summarizeQualityLedger([{ shot: 3, kind: 'video-baked-text', detail: '' }]);
    expect(r.healthScore).toBe(95);
    expect(r.degradedShots).toEqual([]);
  });
});
