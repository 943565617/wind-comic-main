/**
 * v12.259 — Cameo 一致性:LLM Vision 打分 → 视觉嵌入余弦硬判(BYO endpoint,无 key 回落 LLM)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { mapCosineToScore, scoreShotConsistencyEmbedding, scoreShotConsistencyBest, cameoEmbeddingScoringEnabled } from '@/lib/cameo-vision';

describe('v12.259 mapCosineToScore(纯函数)', () => {
  it('默认 floor 0.5 / ceil 0.92:边界与线性', () => {
    expect(mapCosineToScore(0.5)).toBe(0);      // ≤ floor → 0
    expect(mapCosineToScore(0.92)).toBe(100);   // ≥ ceil → 100
    expect(mapCosineToScore(0.71)).toBe(50);    // 中点 ≈ 50
  });
  it('超区间钳制', () => {
    expect(mapCosineToScore(1.0)).toBe(100);
    expect(mapCosineToScore(-0.5)).toBe(0);
    expect(mapCosineToScore(0.3)).toBe(0);
  });
  it('自定义 floor/ceil', () => {
    expect(mapCosineToScore(0.8, 0.6, 1.0)).toBe(50);
    expect(mapCosineToScore(1.0, 0.6, 1.0)).toBe(100);
  });
  it('显式传参 ceil ≤ floor 时退回裸 cos*100(编程用途)', () => {
    expect(mapCosineToScore(0.7, 0.9, 0.8)).toBe(70);
  });
  it('复检修 #2:env FLOOR≥CEIL 配反 → 回落文档默认(而非静默乱映射)', () => {
    const of = process.env.IMAGE_EMBED_SIM_FLOOR, oc = process.env.IMAGE_EMBED_SIM_CEIL;
    process.env.IMAGE_EMBED_SIM_FLOOR = '0.92';
    process.env.IMAGE_EMBED_SIM_CEIL = '0.50'; // 填反
    try {
      // 回落默认 0.5/0.92:cos 0.71 → 50(而非裸 71)
      expect(mapCosineToScore(0.71)).toBe(50);
    } finally {
      if (of === undefined) delete process.env.IMAGE_EMBED_SIM_FLOOR; else process.env.IMAGE_EMBED_SIM_FLOOR = of;
      if (oc === undefined) delete process.env.IMAGE_EMBED_SIM_CEIL; else process.env.IMAGE_EMBED_SIM_CEIL = oc;
    }
  });
});

describe('v12.259 嵌入打分 / 回落(无 key 环境优雅降级)', () => {
  it('未配 IMAGE_EMBED_MODEL → 嵌入打分返回 null(交给 LLM 回落)', async () => {
    // 测试环境无 IMAGE_EMBED_MODEL,hasImageEmbeddingKey() 为 false
    expect(await scoreShotConsistencyEmbedding('https://x/a.png', 'https://x/b.png')).toBeNull();
  });
  it('总入口在无任何 key 时不抛错、优雅返回 null', async () => {
    expect(await scoreShotConsistencyBest('https://x/a.png', 'https://x/b.png', '角色')).toBeNull();
  });
  it('嵌入打分默认关闭(需专用 CAMEO_EMBED_SCORING=1,不因角色库检索开了 embed 就误改重生判定)', () => {
    expect(cameoEmbeddingScoringEnabled()).toBe(false);
  });
});

describe('v12.259 · 接线锁', () => {
  it('cameo-retry 改调 scoreShotConsistencyBest(优先嵌入,回落 LLM)', () => {
    const s = fs.readFileSync('services/cameo-retry.ts', 'utf-8');
    expect(s).toContain('scoreShotConsistencyBest');
    expect(s).not.toMatch(/scoreShotConsistency\(input\.shotImageUrl/); // 旧的纯 LLM 直调已换掉
  });
  it('ShotConsistencyResult 带 method 标注(embedding/llm)', () => {
    const v = fs.readFileSync('lib/cameo-vision.ts', 'utf-8');
    expect(v).toMatch(/method\?:\s*'embedding'\s*\|\s*'llm'/);
    expect(v).toContain("method: 'embedding'");
    expect(v).toContain("method: 'llm'");
  });
  it('复检修 #1:嵌入维度不等 → 返 null 回落 LLM(不拿假 0 分逼重生)', () => {
    const v = fs.readFileSync('lib/cameo-vision.ts', 'utf-8');
    expect(v).toMatch(/shotEmb\.dim !== refEmb\.dim/);
  });
});
