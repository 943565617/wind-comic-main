/**
 * v12.111 — 导演/编剧自检修正轮进质检账本:summarize 摘要 + 轻扣分(重试类 5 分)。
 */
import { describe, it, expect } from 'vitest';
import { summarizeQualityLedger } from '@/lib/quality-report';

describe('v12.111 · director/writer 修正轮记账', () => {
  it('修正轮进摘要,按重试类轻扣分,不算降级镜', () => {
    const r = summarizeQualityLedger([
      { shot: 0, kind: 'director-fix', detail: '6问题已修正' },
      { shot: 0, kind: 'writer-fix', detail: '2问题已修正' },
    ]);
    expect(r.summary).toContain('导演稿自检修正 1 轮');
    expect(r.summary).toContain('剧本自检修正 1 轮');
    expect(r.healthScore).toBe(90); // 2×5
    expect(r.degradedShots).toEqual([]);
    expect(r.affectedShots).toEqual([]); // shot 0 全片级,不进受影响镜列表
  });
  it('与镜级事件共存时摘要顺序不乱', () => {
    const r = summarizeQualityLedger([
      { shot: 3, kind: 'broll-fallback', detail: 'q' },
      { shot: 0, kind: 'director-fix', detail: 'x' },
    ]);
    expect(r.summary).toMatch(/实拍素材兜底.*导演稿自检修正/);
  });
});

describe('v12.115 · 健康分色调', () => {
  it('≥90 绿 / 70-89 琥珀 / <70 红', async () => {
    const { healthTone } = await import('@/lib/quality-report');
    expect(healthTone(100).tone).toBe('good');
    expect(healthTone(90).tone).toBe('good');
    expect(healthTone(89).tone).toBe('warn');
    expect(healthTone(70).tone).toBe('warn');
    expect(healthTone(69).tone).toBe('bad');
    expect(healthTone(20).color).toBe('#e07a6a');
  });
});
