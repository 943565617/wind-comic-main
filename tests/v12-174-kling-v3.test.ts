/**
 * v12.174 — Kling v3 升级:模型 env 化 + 分级时长(v3=15s)。live 验收:S1 kling-v3 succeed。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.174 · kling-v3', () => {
  it('模型 env 化默认 v3;时长按模型分级(v3 支持 15)', () => {
    const s = fs.readFileSync('services/kling.service.ts', 'utf-8');
    expect(s).toContain("process.env.KELING_VIDEO_MODEL || 'kling-v3'");
    expect(s).toContain("model.startsWith('kling-v3') ? 15 : 10");
    expect(s).not.toContain("model_name: 'kling-v1'");
  });
  it('主管线 >10s 镜给 15', () => {
    expect(fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8')).toContain('shot.duration > 10) ? 15');
  });
});
