/**
 * v12.155 — 系列质量中枢:mapPool 纯函数 + series health API + 面板接线锁。
 */
import { describe, it, expect } from 'vitest';
import { mapPool } from '@/lib/film-health-io';
import fs from 'fs';

describe('v12.155 · 系列质量中枢', () => {
  it('mapPool:有界并发、保序、不吞错以外的项', async () => {
    const order: number[] = [];
    let active = 0, peak = 0;
    const out = await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10 - n));
      active--; order.push(n);
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]); // 保序
    expect(peak).toBeLessThanOrEqual(2);        // 并发上限
  });
  it('接线锁:series health API(共用 buildProjectHealth)+ 项目 health 薄化 + 面板徽章/全季补渲', () => {
    const api = fs.readFileSync('app/api/series/[id]/health/route.ts', 'utf-8');
    expect(api).toContain('buildProjectHealth(ep.id)');
    expect(api).toContain('mapPool(episodes, 2');
    const proj = fs.readFileSync('app/api/projects/[id]/health/route.ts', 'utf-8');
    expect(proj).toContain('buildProjectHealth');
    const ui = fs.readFileSync('app/dashboard/series/[id]/page.tsx', 'utf-8');
    // v12.209 i18n:中文文案移到 lib/i18n.ts,页面用 t.seriesDetail.seasonFixLabel
    expect(ui).toContain('t.seriesDetail.seasonFixLabel');
    expect(fs.readFileSync('lib/i18n.ts', 'utf-8')).toContain('全季补渲降级镜');
    expect(ui).toContain('t.seriesDetail.shotsDowngradedLabel'); // v12.209 i18n
    expect(ui).toContain("stage: 'failed-videos'");
  });
});
