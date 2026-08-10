/**
 * v12.149 — 引擎天气面板:weatherSegments 纯函数 + gateway 快照 + Veo 埋点接线锁。
 */
import { describe, it, expect } from 'vitest';
import { weatherSegments } from '@/components/create/engine-weather';
import { markGatewayOutOfCredits, listOutOfCreditsGateways, _resetGatewayBudget } from '@/lib/gateway-budget';
import fs from 'fs';

describe('v12.149 · 引擎天气', () => {
  it('weatherSegments:告警+网关拼可读片段;全空 → []', () => {
    expect(weatherSegments([], [])).toEqual([]);
    const segs = weatherSegments(
      [{ provider: 'minimax', alertType: 'exhausted', lastSeenAt: '', count: 3 }],
      [{ host: 'api.qingyuntop.com', remainingSec: 540 }],
    );
    expect(segs[0]).toContain('MiniMax');
    expect(segs[0]).toContain('余额/额度耗尽');
    expect(segs[1]).toContain('qingyuntop');
    expect(segs[1]).toContain('9 分钟');
  });
  it('v12.177:qingyuntop「该令牌额度已用尽」文案命中破产判定', async () => {
    const { isOutOfCreditsError } = await import('@/lib/gateway-budget');
    expect(isOutOfCreditsError('该令牌额度已用尽 (request id: xxx)')).toBe(true);
    expect(isOutOfCreditsError('quota is not enough')).toBe(true);
    expect(isOutOfCreditsError('invalid params')).toBe(false);
  });
  it('listOutOfCreditsGateways:冷却期内可见,过期自动消失', () => {
    _resetGatewayBudget();
    markGatewayOutOfCredits('https://api.test-gw.com/v1', 60_000, 1000);
    const snap = listOutOfCreditsGateways(2000);
    expect(snap.length).toBe(1);
    expect(snap[0].host).toContain('test-gw');
    expect(listOutOfCreditsGateways(70_000).length).toBe(0);
    _resetGatewayBudget();
  });
  it('接线锁:Veo 失败埋点 + api-status 输出 gateways + 创作页挂载', () => {
    expect(fs.readFileSync('services/veo.service.ts', 'utf-8')).toContain('_trackVeoError(lastError');
    expect(fs.readFileSync('app/api/api-status/route.ts', 'utf-8')).toContain('listOutOfCreditsGateways');
    expect(fs.readFileSync('app/dashboard/create/page.tsx', 'utf-8')).toContain('<EngineWeather />');
  });
});
