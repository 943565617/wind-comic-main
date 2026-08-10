/**
 * v12.125 — 缺失/降级镜自愈识别 + 报告 shotReasons。
 */
import { describe, it, expect } from 'vitest';
import { identifyHealableShots, healPriority, HEALABLE_KINDS } from '@/lib/heal-shots';
import { summarizeQualityLedger } from '@/lib/quality-report';

describe('v12.125 · shotReasons(report 自描述)', () => {
  it('summarize 输出镜号→事件类映射', () => {
    const r = summarizeQualityLedger([
      { shot: 3, kind: 'missing-video', detail: '' },
      { shot: 4, kind: 'video-baked-text', detail: '' },
      { shot: 4, kind: 'broll-fallback', detail: '' },
      { shot: 0, kind: 'director-fix', detail: '' }, // 全片级不进 shotReasons
    ]);
    expect(r.shotReasons).toEqual({ 3: ['missing-video'], 4: ['video-baked-text', 'broll-fallback'] });
  });
});

describe('v12.125 · identifyHealableShots', () => {
  const report = {
    shotReasons: {
      3: ['missing-video'],
      4: ['video-baked-text', 'broll-fallback'],
      5: ['cameo-retry'],          // 非可自愈类 → 不列
      6: ['kenburns-fallback'],
    },
  };
  it('只列可自愈镜,按优先级排序(缺失>烤字>静图>实拍)', () => {
    const h = identifyHealableShots(report, [3, 4, 6]);
    expect(h.map((x) => x.shot)).toEqual([3, 4, 6]); // 4:pri3, 6:pri2, 3:pri4 → 3,4,6
    expect(h[0].shot).toBe(3);      // missing-video 最急
    expect(h[0].priority).toBe(4);
  });
  it('标注有无分镜图(决定 I2V/T2V)', () => {
    const h = identifyHealableShots(report, [3]);        // 只镜3有图
    expect(h.find((x) => x.shot === 3)!.hasStoryboard).toBe(true);
    expect(h.find((x) => x.shot === 4)!.hasStoryboard).toBe(false);
  });
  it('cameo-retry 等非兜底类不算可自愈', () => {
    expect(identifyHealableShots({ shotReasons: { 5: ['cameo-retry', 'shot-gate'] } }, [5])).toEqual([]);
  });
  it('旧报告(仅 degradedShots,无 shotReasons)降级识别', () => {
    const h = identifyHealableShots({ degradedShots: [3] }, [3]);
    expect(h).toHaveLength(1);
    expect(h[0].shot).toBe(3);
    expect(h[0].reasons).toEqual(['degraded']);
  });
  it('空报告 / null 安全', () => {
    expect(identifyHealableShots(null, [1])).toEqual([]);
    expect(identifyHealableShots({}, [1])).toEqual([]);
  });
  it('healPriority + HEALABLE_KINDS 常量', () => {
    expect(healPriority(['missing-video'])).toBe(4);
    expect(healPriority(['broll-fallback'])).toBe(1);
    expect(healPriority(['cameo-retry'])).toBe(0);
    expect(HEALABLE_KINDS).toContain('missing-video');
  });
});
