/**
 * v12.190 — 成本下钻:端点+面板接线锁(live 验:¥16.3/11 条/video-kling 主项)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.190 · 成本下钻', () => {
  it('端点:cost_log × rollupByEngine + 总额', () => {
    const r = fs.readFileSync('app/api/projects/[id]/cost/route.ts', 'utf-8');
    expect(r).toContain('listCostLogByProject');
    expect(r).toContain('rollupByEngine');
    expect(r).toContain('totalCny');
  });
  it('面板:懒加载 + costCny/count 字段(EngineRollup 真实字段名)', () => {
    const ui = fs.readFileSync('app/projects/[id]/page.tsx', 'utf-8');
    expect(ui).toContain('cost-panel');
    expect(ui).toContain('e.costCny');
    expect(ui).toContain('e.count');
  });
});
