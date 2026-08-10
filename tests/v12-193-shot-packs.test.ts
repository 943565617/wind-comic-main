/**
 * v12.193 — 题材镜头包:检测纯函数 + 显式优先接线锁。
 */
import { describe, it, expect } from 'vitest';
import { detectShotPack, GENRE_SHOT_PACKS } from '@/lib/genre-shot-packs';
import fs from 'fs';

describe('v12.193 · 题材镜头包', () => {
  it('三题材检测命中;不命中 null;每包三件套齐全', () => {
    expect(detectShotPack('深夜便利店监控里的失踪谜团')!.id).toBe('suspense');
    expect(detectShotPack('大学暗恋的心动告白')!.id).toBe('sweet');
    expect(detectShotPack('将军回朝,江湖再起')!.id).toBe('costume');
    expect(detectShotPack('新能源汽车广告')).toBeNull();
    for (const p of GENRE_SHOT_PACKS) {
      expect(p.cameraDefault).toBeTruthy();
      expect(p.editStyle).toBeTruthy();
      expect(p.bgmStyleHint).toBeTruthy();
    }
  });
  it('接线锁:显式 cameraDefault/editStyle 不被覆盖', () => {
    const p = fs.readFileSync('lib/create-pipeline.ts', 'utf-8');
    expect(p).toContain('if (!cameraDefault) { orchestrator.setCameraDefault(pack.cameraDefault)');
    expect(p).toContain('if (!editStyle) { orchestrator.setEditStyle(pack.editStyle)');
    expect(p).toContain('题材镜头包');
  });
});
