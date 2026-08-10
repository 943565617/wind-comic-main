/**
 * v12.167 — 分镜规划部分截断守门:任何缺口都规则引擎补齐(接线锁)。
 * live 事故:plans JSON 截断救回只剩 1/4 → 静默只渲 1 镜 → 成片 4.4s(预期 26s)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.167 · 分镜缺口补齐', () => {
  it('规则引擎抽成 buildRulePlans;length < shots.length 即补齐并透出提示', () => {
    const src = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    expect(src).toContain('const buildRulePlans = () => shots.map');
    expect(src).toContain('storyboardPlans.length < shots.length');
    expect(src).toContain('规则引擎补齐');
    expect(src).not.toMatch(/if \(storyboardPlans\.length === 0\) \{\s*\n\s*storyboardPlans = shots\.map/); // 旧「全空才兜底」已移除
  });
});
