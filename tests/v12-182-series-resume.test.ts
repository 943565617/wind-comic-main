/**
 * v12.182 — 断点续跑:resume 端点(卡死 active → draft)+ 面板接线锁。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.182 · 断点续跑', () => {
  it('端点:auth + staleMinutes 判定 + 只动 active 集', () => {
    const r = fs.readFileSync('app/api/series/[id]/resume/route.ts', 'utf-8');
    expect(r).toContain("ep.status !== 'active'");
    expect(r).toContain('staleMinutes');
    expect(r).toContain("setEpisodeStatus(ep.id, 'draft')");
    expect(r).toContain('getUserFromRequest');
  });
  it('面板:有 active 集时提供恢复按钮', () => {
    const ui = fs.readFileSync('app/dashboard/series/[id]/page.tsx', 'utf-8');
    expect(ui).toContain('resumeStuck');
    // v12.209 i18n:中文文案移到 lib/i18n.ts,页面用 t.seriesDetail.resumeStuckBtn
    expect(ui).toContain('t.seriesDetail.resumeStuckBtn');
    expect(fs.readFileSync('lib/i18n.ts', 'utf-8')).toContain('恢复卡死的集');
    expect(ui).toContain("episodes.some((e) => e.status === 'active')");
  });
});
