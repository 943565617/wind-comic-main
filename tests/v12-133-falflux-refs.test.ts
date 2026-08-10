/**
 * v12.133 — issue #2 Bug A/C:参考图引擎路由(falFlux 提为一等参考图引擎)。
 */
import { describe, it, expect } from 'vitest';
import { decideImageRoute, preferFalFluxForRefs, appendSeedreamTier } from '@/lib/image-router';

const chain = (r: { primary: string; fallbacks: string[] }) => [r.primary, ...r.fallbacks];

describe('v12.133 · falFlux 一等参考图引擎', () => {
  it('报告人场景(仅 FAL,无 MJ,1-2 参考图):falflux 上位到不认参考图的引擎之前', () => {
    // MJ 不可用、minimax 不可用 → 原决策 primary=kontext(文本 hint,坏)
    const base = decideImageRoute({ validRefs: ['https://a.png'], mjAvailable: false, minimaxAvailable: false, kontextAvailable: true });
    expect(base.primary).toBe('kontext');
    const fixed = preferFalFluxForRefs(base, 1, true);
    expect(fixed.primary).toBe('falflux');          // falflux 上位
    expect(chain(fixed)).toEqual(['falflux', 'kontext']);
  });

  it('MJ 可用(原生 cref/sref)时保留主位,falflux 紧随其后、在 kontext 之前', () => {
    const base = decideImageRoute({ validRefs: ['https://a.png', 'https://b.png'], mjAvailable: true, minimaxAvailable: true, kontextAvailable: true });
    expect(base.primary).toBe('mj');
    const fixed = preferFalFluxForRefs(base, 2, true);
    expect(fixed.primary).toBe('mj');
    expect(chain(fixed).indexOf('falflux')).toBeLessThan(chain(fixed).indexOf('kontext'));
    expect(chain(fixed).indexOf('falflux')).toBe(1); // 紧随 mj
  });

  it('≥3 参考图:minimax-multi 保主位(用全部参考),falflux 紧随', () => {
    const base = decideImageRoute({ validRefs: ['a','b','c'].map(x=>`https://${x}.png`), mjAvailable: true, minimaxAvailable: true, kontextAvailable: true });
    expect(base.primary).toBe('minimax-multi');
    const fixed = preferFalFluxForRefs(base, 3, true);
    expect(fixed.primary).toBe('minimax-multi');
    expect(chain(fixed)[1]).toBe('falflux');
  });

  it('0 参考图不插 falflux(那时 mj/seedream 画质更优)', () => {
    const base = decideImageRoute({ validRefs: [], mjAvailable: true, minimaxAvailable: true, kontextAvailable: true });
    const fixed = preferFalFluxForRefs(base, 0, true);
    expect(chain(fixed)).not.toContain('falflux');
  });

  it('falFlux 不可用则原样返回', () => {
    const base = decideImageRoute({ validRefs: ['https://a.png'], mjAvailable: false, minimaxAvailable: false, kontextAvailable: true });
    expect(preferFalFluxForRefs(base, 1, false)).toEqual(base);
  });

  it('幂等:重复调用不重复插 falflux', () => {
    const base = decideImageRoute({ validRefs: ['https://a.png'], mjAvailable: false, minimaxAvailable: false, kontextAvailable: true });
    const once = preferFalFluxForRefs(base, 1, true);
    const twice = preferFalFluxForRefs(once, 1, true);
    expect(chain(twice).filter(e => e === 'falflux')).toHaveLength(1);
  });

  it('与 appendSeedreamTier 组合:falflux 在前、seedream 垫底', () => {
    const base = decideImageRoute({ validRefs: ['https://a.png'], mjAvailable: false, minimaxAvailable: false, kontextAvailable: true });
    const composed = appendSeedreamTier(preferFalFluxForRefs(base, 1, true));
    const c = chain(composed);
    expect(c[0]).toBe('falflux');
    expect(c[c.length - 1]).toBe('seedream');
  });
});

describe('v12.140 · seedream i2i(P0-3)', () => {
  it('源码接线锁:seedream 档带参考图走 i2i,失败退 t2i,env 可关', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    expect(src).toContain("SEEDREAM_I2I_DISABLE");
    expect(src).toContain('seedream i2i 失败,退回 t2i');
    expect(src).toMatch(/i2iRefs && i2iRefs\.length > 0 \? \{ image:/);
  });
});
