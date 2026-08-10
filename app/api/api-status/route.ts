/**
 * GET /api/api-status · v2.17 P0.3
 *
 * 公开只读 — 给所有登录用户的 dashboard 用, 让用户在创作前知道
 * "Minimax 余额不足, 视频会自动降级到 Veo" 之类的状态。
 *
 * 不返回 PII / error_message 全文 — 仅返回 provider + alertType + 最近发生时间 + 次数。
 * 真要看错误细节, 走 admin 端的 /api/admin/api-usage。
 */
import { NextResponse } from 'next/server';
import { listActiveQuotaAlerts } from '@/lib/api-usage-tracker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // 只看 1 小时窗口的活跃告警 — 给前端 banner 用
  const alerts = await listActiveQuotaAlerts({ windowMs: 60 * 60 * 1000 });

  // 简化输出: 每个 provider 一条 (取最严重的 alert_type)
  const SEVERITY: Record<string, number> = {
    auth_failed: 4,
    exhausted: 3,
    saturated: 2,
    rate_limited: 1,
  };
  const byProvider = new Map<
    string,
    { provider: string; alertType: string; lastSeenAt: string; count: number }
  >();
  for (const a of alerts) {
    const existing = byProvider.get(a.provider);
    if (!existing || (SEVERITY[a.alertType] || 0) > (SEVERITY[existing.alertType] || 0)) {
      byProvider.set(a.provider, {
        provider: a.provider,
        alertType: a.alertType,
        lastSeenAt: a.lastSeenAt,
        count: a.occurrenceCount,
      });
    }
  }

  // v12.149:内存网关破产快照(qingyuntop/vectorengine 配额耗尽冷却期)—— 与 DB 告警互补,
  // 图像/LLM 网关级「余额不足」秒级可见(DB 告警只覆盖有埋点的 provider)。
  const { listOutOfCreditsGateways } = await import('@/lib/gateway-budget');

  // v12.161:各视频引擎近 10 分钟失败数(≥3 视为不稳)—— 天气条绿色时也能看引擎脉搏
  const { getRecentFailureRate } = await import('@/lib/api-usage-tracker');
  // v12.162(对抗评审 R9):DB 规范键是 'kling'(此前误用前端别名 keling + as any 屏蔽了类型检查,
  // 查询恒 0 行 → Kling 挂了脉搏也绿)。
  const engines = await Promise.all((['veo', 'minimax', 'kling'] as const).map(async (p) => {
    try {
      const r = await getRecentFailureRate(p);
      return { provider: p, recentFailures: r.failed };
    } catch { return { provider: p, recentFailures: 0 }; }
  }));

  // v12.216:引擎能力边界(真机实测结论,env 触发 —— 开了不生效的开关必须让运营者知情)
  const { engineCapabilityNotes } = await import('@/lib/engine-capability-notes');
  return NextResponse.json({
    alerts: Array.from(byProvider.values()),
    gateways: listOutOfCreditsGateways(),
    engines,
    capabilityNotes: engineCapabilityNotes({ env: process.env }),
    timestamp: new Date().toISOString(),
  });
}
