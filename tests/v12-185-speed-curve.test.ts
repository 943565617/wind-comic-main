/**
 * v12.185 — 速度曲线:setpts 分段数学 + 高潮 ramp 预设 + composer 接线锁。
 */
import { describe, it, expect } from 'vitest';
import { speedCurveToSetpts, normalizeCurve, averageSpeed, climaxRamp } from '@/lib/speed-curve';
import fs from 'fs';

describe('v12.185 · 速度曲线数学', () => {
  it('单段=简单除法;多段=嵌套 if 且输出起点累计正确', () => {
    expect(speedCurveToSetpts([{ t: 0, speed: 2 }], 10)).toBe('PTS/2.000');
    const e = speedCurveToSetpts([{ t: 0, speed: 1 }, { t: 2, speed: 0.5 }], 6)!;
    // 段2输出起点 = 2/1 = 2.0;表达式含 if(lt(T,2.000)) 与 (2.0000+(T-2.000)/0.500)
    expect(e).toContain('if(lt(T\\,2.000)');
    expect(e).toContain('(2.0000+(T-2.000)/0.500)/TB');
    expect(speedCurveToSetpts([], 5)).toBeNull();
  });
  it('normalize:排序/补0/clamp;averageSpeed 时长加权', () => {
    const n = normalizeCurve([{ t: 3, speed: 9 }, { t: 1, speed: 0.1 }]);
    expect(n[0]).toEqual({ t: 0, speed: 0.25 });
    expect(n[1].speed).toBe(0.25);
    expect(n[2].speed).toBe(4);
    // 0-2s@1x + 2-6s@0.5x:输出 2+8=10s,平均速 6/10=0.6
    expect(averageSpeed([{ t: 0, speed: 1 }, { t: 2, speed: 0.5 }], 6)).toBeCloseTo(0.6, 3);
  });
  it('climaxRamp:S 形三段;短镜(<2.4s)不折腾', () => {
    const r = climaxRamp(8);
    expect(r.length).toBe(3);
    expect(r[0].speed).toBe(1);
    expect(r[1].speed).toBe(0.6);
    expect(r[1].t).toBeCloseTo(2.4, 1);
    expect(climaxRamp(2)).toEqual([]);
  });
  it('接线锁:强高光标 _wantClimaxRamp(可关);两处 setpts 位点吃曲线', () => {
    const c = fs.readFileSync('services/video-composer.ts', 'utf-8');
    expect(c).toContain('_wantClimaxRamp = true');
    expect(c).toContain("EMOTION_RAMP_DISABLE !== '1'");
    expect((c.match(/speedCurveToSetpts/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});
