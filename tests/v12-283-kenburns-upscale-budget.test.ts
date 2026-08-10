/**
 * v12.283 — Ken Burns 上采样倍数按像素预算封顶(原为无脑 ×4)。
 *
 * 为什么不能直接删上采样:zoompan 按**整数像素**步进,慢速缩放会有肉眼可见的阶梯抖动;
 * 先放大再 zoompan,整数步长相对输出成了亚像素,画面才顺滑。
 *
 * 为什么要封顶(实测,非估算):
 *   竖屏 720p (→2880×5120)  峰值 RSS 180 MB
 *   竖屏 1080p(→4320×7680)  峰值 RSS 391 MB
 *   竖屏 4K ×4(→8640×15360) 峰值 RSS 1.39 GB / 3906ms
 *   竖屏 4K ×2(→4320×7680)  峰值 RSS 1.08 GB / 1521ms
 *
 * ⚠️ 诚实修正:审计把这条定性为「OOM 风险」,但实测**内存只降 1.3×**(大头是 ffmpeg 基线
 * 与 x264 编码器,不是上采样),**真正的收益在耗时:降 2.6×**。本版按实测口径描述,不沿用原定性。
 */
import { describe, it, expect } from 'vitest';
import { kenBurnsFilter } from '@/services/video-composer';

const factorOf = (w: number, h: number): number => {
  const f = kenBurnsFilter('in', 48, w, h, 24);
  const m = f.match(/scale=(\d+):(\d+)/);
  expect(m, '滤镜链应以 scale 开头').toBeTruthy();
  return Number(m![1]) / w;
};

describe('v12.283 · 上采样倍数按像素预算', () => {
  it('零回归:竖屏/横屏 720p 仍是 ×4(最常用档,与旧版逐字节一致)', () => {
    expect(factorOf(720, 1280)).toBe(4);
    expect(factorOf(1280, 720)).toBe(4);
  });

  it('1080p 降到 ×2(像素预算生效)', () => {
    expect(factorOf(1080, 1920)).toBe(2);
  });

  it('4K 保底 ×2 —— 不为省内存把亚像素平滑砍到 1×', () => {
    expect(factorOf(2160, 3840)).toBe(2);
  });

  it('倍数恒在 [2,4] 区间(下限保画质、上限控开销)', () => {
    for (const [w, h] of [[64, 64], [720, 1280], [1080, 1920], [2160, 3840], [7680, 4320]]) {
      const f = factorOf(w, h);
      expect(f, `${w}x${h} 倍数越界`).toBeGreaterThanOrEqual(2);
      expect(f, `${w}x${h} 倍数越界`).toBeLessThanOrEqual(4);
      expect(Number.isInteger(f), `${w}x${h} 倍数应为整数`).toBe(true);
    }
  });

  it('极小尺寸不炸(除零/负数保护)', () => {
    expect(() => kenBurnsFilter('in', 48, 1, 1, 24)).not.toThrow();
    expect(factorOf(1, 1)).toBe(4);
  });
});

describe('v12.283 · 滤镜链结构不变(只动倍数)', () => {
  it('三段结构仍是 scale → crop → zoompan → format', () => {
    const f = kenBurnsFilter('in', 48, 720, 1280, 24);
    const parts = f.split(',').map((x) => x.split('=')[0]);
    expect(parts[0]).toBe('scale');
    expect(parts).toContain('crop');
    expect(f).toContain('zoompan=');
    expect(f.endsWith('format=yuv420p')).toBe(true);
  });

  it('输出尺寸仍是原始 w×h(上采样只是中间态)', () => {
    const f = kenBurnsFilter('in', 48, 1080, 1920, 24);
    expect(f).toContain('s=1080x1920');
  });

  it('三种运镜方向都能产出合法链', () => {
    for (const dir of ['in', 'out', 'pan'] as const) {
      const f = kenBurnsFilter(dir, 72, 1080, 1920, 24);
      expect(f).toContain('zoompan=z=');
      expect(f).toContain('d=72');
    }
  });

  it('crop 尺寸与 scale 尺寸一致(不能一个封顶一个没封)', () => {
    for (const [w, h] of [[720, 1280], [1080, 1920], [2160, 3840]]) {
      const f = kenBurnsFilter('in', 48, w, h, 24);
      const sc = f.match(/scale=(\d+):(\d+)/)!;
      const cr = f.match(/crop=(\d+):(\d+)/)!;
      expect([cr[1], cr[2]]).toEqual([sc[1], sc[2]]);
    }
  });
});
