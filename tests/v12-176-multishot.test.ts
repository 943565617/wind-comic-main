/**
 * v12.176 — 多镜合并(KLING_MULTISHOT opt-in):分组/合并 prompt 纯函数 + 接线锁。
 */
import { describe, it, expect } from 'vitest';
import { groupContinuousShots, buildMultiShotPrompt } from '@/lib/multi-shot-merge';
import fs from 'fs';

const S = (n: number, d: number, tr?: string, scene = '出租车内,雨夜') => ({ shotNumber: n, duration: d, transition: tr, sceneDescription: scene, visualPrompt: `vp${n}` });

describe('v12.176 · groupContinuousShots', () => {
  it('continuous+同场景相邻合并;≤3镜/≤15s 约束;跨场景断组', () => {
    const g = groupContinuousShots([S(1, 5), S(2, 5, 'continuous'), S(3, 4, 'continuous'), S(4, 5, 'continuous'), S(5, 5, 'cut', '天台')]);
    expect(g.map((x) => x.shots.map((s) => s.shotNumber))).toEqual([[1, 2, 3], [4], [5]]); // 15s 满断组;cut 断组
    expect(g[0].totalSec).toBe(14);
    const g2 = groupContinuousShots([S(1, 5), S(2, 5, 'continuous', '完全不同的场景描述XYZ')]);
    expect(g2.length).toBe(2); // 场景不同不并
  });
  it('buildMultiShotPrompt:多镜编号+时长;单镜原样', () => {
    const g = groupContinuousShots([S(1, 5), S(2, 5, 'continuous')]);
    const p = buildMultiShotPrompt(g[0]);
    expect(p).toContain('Shot 1 (~5s): vp1');
    expect(p).toContain('Shot 2 (~5s): vp2');
    expect(p).toContain('seamless camera flow');
    expect(buildMultiShotPrompt({ shots: [S(9, 5)], totalSec: 5 })).toBe('vp9');
  });
  it('接线锁:opt-in 环境开关、分组表在循环外、组员复用、组首合并、失败退单镜', () => {
    const o = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    expect(o).toContain("KLING_MULTISHOT === '1'");
    expect(o).toContain('msProducedByHead.get(msInfo.headShot)');
    expect(o).toContain('多镜合并');
    expect(o).toContain('合并失败,退单镜');
    // 分组表须在 per-shot 循环外(msProducedByHead 声明早于第一处 board.shotNumber 使用)
    expect(o.indexOf('msProducedByHead = new Map')).toBeLessThan(o.indexOf('[Video] Shot ${board.shotNumber}'));
  });
});
