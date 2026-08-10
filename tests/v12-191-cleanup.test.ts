/**
 * v12.191 — 媒体清理 cron:接线锁(live 干跑验:composed 149 文件/928MB 识别)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.191 · 媒体清理', () => {
  it('cron 端点:CRON_SECRET 校验 + dryRun + 分目录年龄策略(composed/exports 7d, media 14d, storage 30d)', () => {
    const r = fs.readFileSync('app/api/cron/cleanup-media/route.ts', 'utf-8');
    expect(r).toContain('CRON_SECRET');
    expect(r).toContain("dryRun") ;
    expect(r).toContain("'composed'), 7");
    expect(r).toContain("'media'), 14");
    expect(r).toContain('maxAgeDays: 30');
  });
});
