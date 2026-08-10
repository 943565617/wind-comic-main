/**
 * v12.275 — 节奏审计 v2。
 *
 * 立项依据(2026-08-07 竞品核验):全部已查竞品(含首个同构开源竞品 ViMax)都没有节奏审计;
 * 而市场数据显示制作成本仅占总盘 7.5%、爆款率 <0.1% —— 工具的价值在**降废片率**,
 * 所以审计必须能指出「改哪几镜」,而不是给一个平均分。
 *
 * v1 结构上看不见的四件事,这里逐项验判别力(不只是「不报错」)。
 */
import { describe, it, expect } from 'vitest';
import {
  conflictSlope,
  analyzeConflictShape,
  findDragSegments,
  auditOpening,
  auditDurationRhythm,
  auditPacingV2,
} from '@/lib/pacing-audit-v2';
import { auditScript } from '@/lib/pacing-audit';

describe('v12.275 · 冲突曲线形状(平均分掩盖不了了)', () => {
  it('斜率:递增为正、递减为负、平铺≈0;样本不足返 0', () => {
    expect(conflictSlope([1, 2, 3, 4])).toBeGreaterThan(0);
    expect(conflictSlope([4, 3, 2, 1])).toBeLessThan(0);
    expect(conflictSlope([3, 3, 3, 3])).toBe(0);
    expect(conflictSlope([5])).toBe(0);
    expect(conflictSlope([])).toBe(0);
  });

  it('同一平均分、不同形状 → 判为不同(这正是 v1 看不见的)', () => {
    const rising = [1, 2, 4, 9];   // 均值 4
    const falling = [9, 4, 2, 1];  // 均值 4,与 rising 相同
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(avg(rising)).toBe(avg(falling)); // 前提:v1 的平均分完全相同
    expect(analyzeConflictShape(rising).shape).toBe('escalating');
    expect(analyzeConflictShape(falling).shape).toBe('front-loaded');
  });

  it('高开低走:峰值在前段 + 给出可执行提示', () => {
    const r = analyzeConflictShape([9, 8, 3, 2, 1]);
    expect(r.shape).toBe('front-loaded');
    expect(r.peakIndex).toBe(1);
    expect(r.peakPosition).toBeLessThan(0.5);
    expect(r.warning).toContain('高开低走');
  });

  it('无显著高潮:峰值不突出 → no-climax(全程温吞)', () => {
    const r = analyzeConflictShape([5, 5, 6, 5, 5]);
    expect(r.shape).toBe('no-climax');
    expect(r.peakProminence).toBeLessThan(1.5);
  });

  it('空输入不炸', () => {
    expect(analyzeConflictShape([]).shape).toBe('flat');
  });
});

describe('v12.275 · 拖沓段定位(报到具体镜号区间)', () => {
  it('连续低分段被圈出,1-based 闭区间', () => {
    const segs = findDragSegments([8, 7, 1, 1, 2, 9], { threshold: 3, minRun: 3 });
    expect(segs).toHaveLength(1);
    expect(segs[0].fromShot).toBe(3);
    expect(segs[0].toShot).toBe(5);
    expect(segs[0].length).toBe(3);
  });

  it('不足 minRun 的短低谷不算拖沓(避免噪声告警)', () => {
    expect(findDragSegments([8, 1, 1, 9], { threshold: 3, minRun: 3 })).toEqual([]);
  });

  it('结尾处的拖沓段也能收口(边界)', () => {
    const segs = findDragSegments([9, 1, 1, 1], { threshold: 3, minRun: 3 });
    expect(segs).toHaveLength(1);
    expect(segs[0].toShot).toBe(4);
  });

  it('多段各自独立报出', () => {
    const segs = findDragSegments([1, 1, 1, 9, 1, 1, 1], { threshold: 3, minRun: 3 });
    expect(segs.map((s) => [s.fromShot, s.toShot])).toEqual([[1, 3], [5, 7]]);
  });
});

describe('v12.275 · 开场密度(完播率由前段决定)', () => {
  it('开场弱 → 不达标 + 明确点出完播风险', () => {
    const r = auditOpening([1, 1, 9, 9, 9, 9], [], { dramaMode: true });
    expect(r.passed).toBe(false);
    expect(r.warning).toContain('完播率');
  });

  it('开场强 → 达标', () => {
    expect(auditOpening([8, 9, 2, 2, 2, 2], [], { dramaMode: true }).passed).toBe(true);
  });

  it('只统计落在开场窗口内的反转', () => {
    const r = auditOpening([8, 9, 8, 8, 8, 8], [{ fromShot: 1, toShot: 2 }, { fromShot: 5, toShot: 6 }], {});
    expect(r.reversals).toBe(1); // 第 5→6 的反转在窗口外
  });

  it('空剧本不炸且不误报', () => {
    const r = auditOpening([], [], {});
    expect(r.passed).toBe(true);
    expect(r.warning).toBeNull();
  });
});

describe('v12.275 · 时长节奏(v1 完全没看 duration)', () => {
  it('全片等长 → 报呆板', () => {
    const r = auditDurationRhythm([{ duration: 4 }, { duration: 4 }, { duration: 4 }, { duration: 4 }]);
    expect(r.cv).toBeCloseTo(0, 5);
    expect(r.warning).toContain('呆板');
  });

  it('长镜堆叠 → 报拖沓并给出连续条数', () => {
    const r = auditDurationRhythm([{ duration: 2 }, { duration: 2 }, { duration: 9 }, { duration: 9 }, { duration: 9 }]);
    expect(r.longestRun).toBeGreaterThanOrEqual(3);
    expect(r.warning).toContain('长镜堆叠');
  });

  it('疏密有致 → 不告警', () => {
    expect(auditDurationRhythm([{ duration: 2 }, { duration: 5 }, { duration: 3 }, { duration: 7 }]).warning).toBeNull();
  });

  it('样本不足(<3)不猜测', () => {
    const r = auditDurationRhythm([{ duration: 3 }, { duration: 5 }]);
    expect(r.warning).toBeNull();
    expect(r.sampled).toBe(2);
  });
});

describe('v12.275 · 接入 auditScript(零回归)', () => {
  const mk = (rows: Array<{ act: string; emo: string; d?: string; dur?: number }>) =>
    ({ shots: rows.map((a, i) => ({ shotNumber: i + 1, sceneDescription: '', action: a.act, emotion: a.emo, characters: ['A'], dialogue: a.d, duration: a.dur })) }) as any;

  it('v1 字段一个不少,v2 作为附加字段出现', () => {
    const r: any = auditScript(mk([{ act: '她怒吼', emo: '愤怒', d: '你走!', dur: 3 }]), { dramaMode: true });
    // v1 契约不变
    for (const k of ['dramaMode', 'averageConflictScore', 'reversalCount', 'reversalDensity', 'passed', 'shots', 'warnings', 'suggestions']) {
      expect(r, `v1 字段 ${k} 缺失`).toHaveProperty(k);
    }
    expect(r.v2).toBeTruthy();
    expect(Array.isArray(r.v2.actionable)).toBe(true);
  });

  it('废片样本(高开低走+中段拖沓+等长)比良品样本产出更多可执行建议', () => {
    const bad: any = auditScript(mk([
      { act: '她一巴掌打过去,怒吼撕破婚约', emo: '愤怒', d: '你竟敢背叛我!', dur: 4 },
      { act: '他跪地哀求,场面失控', emo: '绝望', d: '求你别走', dur: 4 },
      { act: '两人走在路上', emo: '平静', dur: 4 },
      { act: '她看着窗外', emo: '平静', dur: 4 },
      { act: '他喝了口水', emo: '平静', dur: 4 },
      { act: '天亮了', emo: '平静', dur: 4 },
    ]), { dramaMode: true });
    const good: any = auditScript(mk([
      { act: '她收到匿名短信,心头一紧', emo: '不安', d: '这是谁?', dur: 2 },
      { act: '她发现合同被动过手脚', emo: '震惊', d: '不可能!', dur: 3 },
      { act: '对峙升级,他冷笑承认', emo: '愤怒', d: '是我做的又如何', dur: 5 },
      { act: '她当众甩出证据,全场哗然,反转', emo: '决绝', d: '那就法庭见', dur: 7 },
    ]), { dramaMode: true });

    expect(bad.v2.shape.shape).toBe('front-loaded');
    expect(bad.v2.dragSegments.length).toBeGreaterThan(0);
    expect(bad.v2.durationRhythm.warning).toContain('呆板');
    expect(good.v2.shape.shape).toBe('escalating');
    expect(good.v2.dragSegments).toHaveLength(0);
    expect(bad.v2.actionable.length).toBeGreaterThan(good.v2.actionable.length);
  });

  it('空剧本走 v2 不抛异常', () => {
    expect(() => auditScript({ shots: [] } as any)).not.toThrow();
  });
});

describe('v12.275 · auditPacingV2 汇总', () => {
  it('建议按「开场 → 形状 → 拖沓段 → 时长」顺序,且指到镜号', () => {
    const r = auditPacingV2(
      [{ duration: 4 }, { duration: 4 }, { duration: 4 }, { duration: 4 }, { duration: 4 }],
      [9, 8, 1, 1, 1],
      [],
      { dramaMode: true },
    );
    expect(r.actionable.length).toBeGreaterThanOrEqual(2);
    expect(r.actionable.some((a) => /第 3~5 镜/.test(a))).toBe(true);
  });
});
