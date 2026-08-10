/**
 * v12.173 — Sora 退役迁移:默认链零 sora + 示例文件不再引导 + 显式配置运行时告警。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.173 · Sora 退役', () => {
  it('默认 fallback 链与 .env.example 均无 sora 推荐', () => {
    const cfg = fs.readFileSync('lib/config.ts', 'utf-8');
    const defMatch = cfg.match(/VEO_FALLBACK_MODELS \|\| '([^']+)'/);
    expect(defMatch![1]).not.toMatch(/sora/i);
    const ex = fs.readFileSync('.env.example', 'utf-8');
    expect(ex).not.toMatch(/^VEO_MODEL=sora/m);
    expect(ex).toContain('2026-09-24');
  });
  it('显式配置 sora 系 → 运行时退役告警', () => {
    const svc = fs.readFileSync('services/veo.service.ts', 'utf-8');
    expect(svc).toContain('2026-09-24 停服');
    expect(svc).toContain("startsWith('sora')");
  });
});
