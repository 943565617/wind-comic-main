/**
 * v12.143 — 创作工坊分镜草图锁(全片模式)接线锁:UI→create-stream→pipeline→orchestrator。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.143 · 全片草图锁接线', () => {
  it('orchestrator:setSketchLockAll + 逐镜草图前置 + emit storyboardSketch', () => {
    const src = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    expect(src).toContain('setSketchLockAll');
    expect(src).toContain('sketchUrlForShot');
    expect(src).toContain("this.emit('storyboardSketch'");
    expect(src).toContain('sketchLock: !!sketchUrlForShot');
  });
  it('pipeline:sketchLock 输入 + setter 调用 + storyboardSketch 落资产', () => {
    const src = fs.readFileSync('lib/create-pipeline.ts', 'utf-8');
    expect(src).toContain('sketchLock?: boolean');
    expect(src).toContain('setSketchLockAll(true)');
    expect(src).toContain("type === 'storyboardSketch'");
    expect(src).toContain("type: 'storyboard-sketch'");
  });
  it('create-stream 透传 + 创作页开关(默认关)', () => {
    const api = fs.readFileSync('app/api/create-stream/route.ts', 'utf-8');
    expect(api).toContain('sketchLock: sketchLock === true');
    const ui = fs.readFileSync('app/dashboard/create/page.tsx', 'utf-8');
    expect(ui).toContain('useState(false);\n');
    expect(ui).toContain('sketchLock: sketchLock || undefined');
    expect(ui).toContain('分镜草图锁');
  });
});
