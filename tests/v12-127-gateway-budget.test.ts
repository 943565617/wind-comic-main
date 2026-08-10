/**
 * v12.127 — 网关配额感知:破产判定 / host 归并 / TTL 冷却 / 尝试过滤(全破产保底)。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  gatewayHost, isOutOfCreditsError, markGatewayOutOfCredits, isGatewayOutOfCredits,
  filterFundedAttempts, _resetGatewayBudget,
} from '@/lib/gateway-budget';

describe('v12.127 · 网关配额感知', () => {
  beforeEach(() => _resetGatewayBudget());

  it('gatewayHost:完整 URL / baseURL 都取 host', () => {
    expect(gatewayHost('https://api.qingyuntop.top/v1')).toBe('api.qingyuntop.top');
    expect(gatewayHost('https://openrouter.ai/api/v1')).toBe('openrouter.ai');
    expect(gatewayHost('')).toBe('');
  });

  it('isOutOfCreditsError:配额/欠费文案命中,瞬时 429/普通错误不命中', () => {
    expect(isOutOfCreditsError('token quota is not enough')).toBe(true);
    expect(isOutOfCreditsError('Token quota exhausted')).toBe(true);
    expect(isOutOfCreditsError('HTTP 403: insufficient quota')).toBe(true);
    expect(isOutOfCreditsError('余额不足')).toBe(true);
    expect(isOutOfCreditsError('429 rate limited')).toBe(false);
    expect(isOutOfCreditsError('timeout')).toBe(false);
    expect(isOutOfCreditsError('500 internal error')).toBe(false);
  });

  it('mark/is:按 host 归并(同网关不同路径共用破产信号),TTL 到期自愈', () => {
    markGatewayOutOfCredits('https://api.qingyuntop.top/v1', 1000, 0);
    expect(isGatewayOutOfCredits('https://api.qingyuntop.top/ent/v2', 500)).toBe(true); // 同 host
    expect(isGatewayOutOfCredits('https://api.minimaxi.com/v1', 500)).toBe(false);
    expect(isGatewayOutOfCredits('https://api.qingyuntop.top/v1', 1500)).toBe(false);   // TTL 过期
  });

  it('filterFundedAttempts:破产网关被滤,全破产保底留末位', () => {
    const A = { baseURL: 'https://api.qingyuntop.top/v1', model: 'fable-5' };
    const B = { baseURL: 'https://openrouter.ai/api/v1', model: 'deepseek' };
    markGatewayOutOfCredits(A.baseURL, 10_000, 0);
    expect(filterFundedAttempts([A, B], 100)).toEqual([B]);
    markGatewayOutOfCredits(B.baseURL, 10_000, 0);
    expect(filterFundedAttempts([A, B], 100)).toEqual([B]); // 全破产 → 末位最后一搏
  });
});
