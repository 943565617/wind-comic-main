/**
 * v12.151 — animatic 情绪运镜联动:movementToKenBurns 纯函数 + orchestrator 接线锁。
 */
import { describe, it, expect } from 'vitest';
import { movementToKenBurns } from '@/lib/emotion-camera';
import fs from 'fs';

describe('v12.151 · movementToKenBurns', () => {
  it('推近类→in,拉远类→out,横移/环绕/手持→pan,static→轻缓推,空/未知→null', () => {
    expect(movementToKenBurns('push-in')).toBe('in');
    expect(movementToKenBurns('dolly-in')).toBe('in');
    expect(movementToKenBurns('zoom-out')).toBe('out');
    expect(movementToKenBurns('pull-out')).toBe('out');
    expect(movementToKenBurns('pan-left')).toBe('pan');
    expect(movementToKenBurns('truck-right')).toBe('pan');
    expect(movementToKenBurns('orbit')).toBe('pan');
    expect(movementToKenBurns('handheld')).toBe('pan');
    expect(movementToKenBurns('static')).toBe('in');
    expect(movementToKenBurns('缓慢推近(dolly-in)')).toBe('in'); // 中文自由文本
    expect(movementToKenBurns('')).toBeNull();
    expect(movementToKenBurns('不知道什么')).toBeNull();
  });
  it('接线锁:animatic 循环方向优先运镜、轮换兜底', () => {
    const src = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    expect(src).toContain('movementToKenBurns(shotMove)');
    expect(src).toMatch(/movementToKenBurns\(shotMove\)\s*\n?\s*\?\? \(\['in', 'out', 'pan'\] as const\)\[i % 3\]/);
  });
});
