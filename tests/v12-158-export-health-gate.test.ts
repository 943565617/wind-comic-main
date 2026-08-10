/**
 * v12.158 — 整季导出体检闸门:接线锁(409 health_gate + ignoreHealth 旁路 + UI confirm 重试)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.158 · 导出体检闸门', () => {
  it('路由:默认体检、fail/降级镜 409、ignoreHealth 旁路、闸门在并发锁之前', () => {
    const src = fs.readFileSync('app/api/series/[id]/export/route.ts', 'utf-8');
    expect(src).toContain("reqBody?.ignoreHealth !== true");
    expect(src).toContain("error: 'health_gate'");
    expect(src).toContain('buildProjectHealth(e.id)');
    // 闸门先于锁,拒绝不占锁。
    // v12.227:并发锁由进程内 `inFlight` Set 换成跨实例 DB CAS 锁(acquireLock),
    // 断言锚点随之更新 —— 语义不变:体检不过要在**拿锁之前**就 409,否则会白占一把 5 分钟 TTL 的锁。
    expect(src.indexOf('health_gate')).toBeLessThan(src.indexOf('acquireLock('));
  });
  it('UI:409 health_gate → confirm → ignoreHealth 重试', () => {
    const ui = fs.readFileSync('app/dashboard/series/[id]/page.tsx', 'utf-8');
    expect(ui).toContain("body?.error === 'health_gate'");
    expect(ui).toContain('ignoreHealth: true');
    expect(ui).toContain('window.confirm');
  });
});
