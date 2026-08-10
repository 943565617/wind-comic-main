/**
 * v12.128 — 图像路由接入网关配额感知(接线锁 + 纯逻辑复用)。
 * apiImage/kontextImage 两个 HTTP 边界都要:破产预检 skip + 403/配额错误 mark。
 */
import { describe, it, expect } from 'vitest';
import { isGatewayOutOfCredits, markGatewayOutOfCredits, _resetGatewayBudget } from '@/lib/gateway-budget';

describe('v12.128 · 图像路由配额感知', () => {
  it('orchestrator 两处图像调用均接入预检+标记', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    // apiImage + kontextImage 两处各有一个 isGatewayOutOfCredits 预检
    expect((src.match(/isGatewayOutOfCredits\(/g) || []).length).toBeGreaterThanOrEqual(2);
    // 两处 !res.ok 分支各标记一次破产
    expect((src.match(/markGatewayOutOfCredits\(/g) || []).length).toBeGreaterThanOrEqual(2);
    // 配额错误判定也接入
    expect(src).toContain('isOutOfCreditsError(errBody)');
  });

  it('qingyuntop 破产后同 host 图像 base 一并跳过(host 归并)', () => {
    _resetGatewayBudget();
    markGatewayOutOfCredits('https://api.qingyuntop.top/v1', 10_000, 0);
    // seedream/kontext 用的 qytBase 同 host → 命中
    expect(isGatewayOutOfCredits('https://api.qingyuntop.top', 100)).toBe(true);
    // vectorengine 不同 host → 不受影响
    expect(isGatewayOutOfCredits('https://api.vectorengine.ai', 100)).toBe(false);
  });
});
