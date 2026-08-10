/**
 * v12.135 — 镜头语言草图锁(可选,默认关):开关/构图提示/refs 并入/施加方式。
 */
import { describe, it, expect } from 'vitest';
import { shouldSketchLock, buildSketchDirective, mergeSketchIntoRefs, sketchApplyMode } from '@/lib/storyboard-sketch';

describe('v12.135 · 草图锁开关', () => {
  it('默认关;env=1 或请求 opt-in 开;显式关优先', () => {
    expect(shouldSketchLock({} as any)).toBe(false);
    expect(shouldSketchLock({ STORYBOARD_SKETCH_LOCK: '1' } as any)).toBe(true);
    expect(shouldSketchLock({} as any, true)).toBe(true);
    expect(shouldSketchLock({ STORYBOARD_SKETCH_LOCK: '1' } as any, false)).toBe(false); // 请求显式关优先
  });
});

describe('v12.135 · 构图提示 + refs', () => {
  it('buildSketchDirective:锁构图/机位,带 meta 更具体', () => {
    expect(buildSketchDirective()).toContain('STORYBOARD LOCK');
    const d = buildSketchDirective({ shotSize: 'close-up', angle: 'low angle' });
    expect(d).toContain('close-up');
    expect(d).toContain('low angle');
    expect(d).toContain('LAYOUT ONLY'); // 只锁布局,细节/配色仍由 prompt 决定
  });
  it('mergeSketchIntoRefs:草图置最前、去重、限 4、丢非 http', () => {
    expect(mergeSketchIntoRefs('https://s.png', ['https://a.png', 'https://b.png'])).toEqual(['https://s.png', 'https://a.png', 'https://b.png']);
    expect(mergeSketchIntoRefs('https://s.png', ['https://s.png'])).toEqual(['https://s.png']); // 去重
    expect(mergeSketchIntoRefs('https://s.png', ['data:xxx', 'https://a.png'])).toEqual(['https://s.png', 'https://a.png']); // 丢 data:
    expect(mergeSketchIntoRefs('https://s.png', ['https://a.png','https://b.png','https://c.png','https://d.png']).length).toBe(4);
  });
});

describe('v12.135 · 施加方式', () => {
  it('comfyui+ControlNet→硬锁;image 引擎→参考图;其余→none', () => {
    expect(sketchApplyMode('comfyui', true)).toBe('controlnet');
    expect(sketchApplyMode('comfyui', false)).toBe('none'); // 未启 ControlNet
    expect(sketchApplyMode('falflux')).toBe('reference');
    expect(sketchApplyMode('kontext')).toBe('reference');
    expect(sketchApplyMode('unknown')).toBe('none');
  });
});
