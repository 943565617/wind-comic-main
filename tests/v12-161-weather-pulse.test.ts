/**
 * v12.161 — 天气条引擎脉搏 + 批量补渲并发:纯函数与接线锁。
 */
import { describe, it, expect } from 'vitest';
import { weatherSegments } from '@/components/create/engine-weather';
import fs from 'fs';

describe('v12.161 · 引擎脉搏', () => {
  it('近10分钟失败 ≥3 亮条,<3 静默', () => {
    expect(weatherSegments([], [], [{ provider: 'kling', recentFailures: 2 }])).toEqual([]);
    const segs = weatherSegments([], [], [{ provider: 'kling', recentFailures: 4 }]);
    expect(segs[0]).toContain('可灵');
    expect(segs[0]).toContain('4 次');
  });
  it('接线锁:api-status 输出 engines;批量补渲走 mapPool 并发 2', () => {
    const api = fs.readFileSync('app/api/api-status/route.ts', 'utf-8');
    expect(api).toContain('recentFailures');
    // v12.162(对抗评审):DB 键必须是规范 'kling',别名 'keling' 查询恒 0
    expect(api).toContain("'veo', 'minimax', 'kling'");
    expect(api).not.toContain("'keling'");
    // Kling 失败必须有埋点,否则脉搏对 Kling 全盲
    expect(fs.readFileSync('services/kling.service.ts', 'utf-8')).toContain('_trackKlingError');
    const r = fs.readFileSync('app/api/regenerate-shot/route.ts', 'utf-8');
    expect(r).toContain('mapPool(targets, 2');
  });
});
