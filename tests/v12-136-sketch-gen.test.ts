/**
 * v12.136 — AI 草图生成 prompt(纯):压细节/配色、只锁构图、带机位元数据。
 */
import { describe, it, expect } from 'vitest';
import { buildSketchGenPrompt } from '@/lib/storyboard-sketch';

describe('v12.136 · 草图生成 prompt', () => {
  it('粗线稿黑白、只锁构图', () => {
    const p = buildSketchGenPrompt('主角站在天台边缘俯视城市');
    expect(p.toLowerCase()).toContain('black-and-white');
    expect(p.toLowerCase()).toContain('line art');
    expect(p.toLowerCase()).toContain('layout');
    expect(p).toContain('主角站在天台边缘俯视城市');
  });
  it('带机位元数据更具体', () => {
    const p = buildSketchGenPrompt('two people talking', { shotSize: 'wide shot', angle: 'high angle', movement: 'slow push-in' });
    expect(p).toContain('wide shot');
    expect(p).toContain('high angle');
    expect(p).toContain('slow push-in');
  });
  it('空场景兜底、超长截断', () => {
    expect(buildSketchGenPrompt('')).toContain('a single shot');
    expect(buildSketchGenPrompt("x".repeat(999)).length).toBeLessThan(900);
  });
});
