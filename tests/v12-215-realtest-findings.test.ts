/**
 * v12.215 — Kling 真机测试发现固化(4K✓/enable_audio实测无效/lip-sync 2s下限),防未来误改。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.215 · 真机发现固化', () => {
  it('enable_audio 注释警示「实测不产音轨/走 TTS+BGM」(防误以为能出声)', () => {
    const k = fs.readFileSync('services/kling.service.ts', 'utf-8');
    expect(k).toMatch(/enable_audio.*名义接受、实际无效|本账号实测不产音轨/);
    expect(k).toContain('走 MiniMax TTS + BGM');
  });
  it('lip-sync 注释记录 2s 下限 + 公网 URL 要求(真机测得)', () => {
    const l = fs.readFileSync('services/lipsync-providers.ts', 'utf-8');
    expect(l).toContain('时长必须 ≥2s');
    expect(l).toMatch(/公网可访问/);
  });
  it('4K render4K 路径仍在(真机验 2160×3840)', () => {
    const k = fs.readFileSync('services/kling.service.ts', 'utf-8');
    expect(k).toContain("mode: want4K ? '4k'");
  });
});
