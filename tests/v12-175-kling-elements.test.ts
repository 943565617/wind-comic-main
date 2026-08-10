/**
 * v12.175 — Kling Elements 多图端点:方法与接线锁(端点/模型/落回)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.175 · Kling Elements', () => {
  it('service:multi-image2video 端点 + v1-6 专属模型 + ≤4 图 + data URI 剥前缀', () => {
    const s = fs.readFileSync('services/kling.service.ts', 'utf-8');
    expect(s).toContain('/v1/videos/multi-image2video');
    expect(s).toContain("KELING_ELEMENTS_MODEL || 'kling-v1-6'");
    expect(s).toContain('.slice(0, 4)');
    expect(s).toContain("u.split(',')[1] : u");
    expect(s).toContain('pollMultiImageResult');
  });
  it('主管线:KLING_ELEMENTS=1 且有锁角 → 优先 Elements,失败落回单图', () => {
    const o = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    expect(o).toContain("KLING_ELEMENTS === '1' && subjRefs.length > 0");
    expect(o).toContain('generateVideoWithElements(elemImages');
    expect(o).toContain('失败退回单图');
  });
});
