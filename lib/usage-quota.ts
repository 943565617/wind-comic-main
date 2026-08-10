/**
 * v12.223 — 月度用量护栏(真实成本口径)。
 *
 * 病根(🔴-6):订阅档无用量上限,单个 4K 重度用户月成本可超订阅价数倍 → 每卖一单亏一单。
 * 本模块把「本月已花(cost_log 真实记账)」与「订阅档月度成本上限(pricing.limits)」对齐,
 * 超额则由调用方降级到经济引擎或提示充值。上限为软护栏(先提示后拦),非硬扣费。
 */
import { getDbDriver } from './db-driver';
import { getTierById } from './pricing';

/** 某档月度成本上限(¥)。-1 = 不设上限(企业)。未知档按 free 兜底。 */
export function tierMonthlyCeilingCny(tierId: string | null | undefined): number {
  const tier = getTierById(tierId || 'free');
  return tier?.limits.monthlyCostCeilingCny ?? 5;
}

/** 当前自然月起点 ISO(用于按月汇总)。testNow 便于测试注入。 */
export function monthStartISO(testNow?: Date): string {
  const now = testNow ?? new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

/** 累计某用户本自然月已花真实成本(¥,来自 cost_log)。 */
export async function getMonthlyCostCny(userId: string, testNow?: Date): Promise<number> {
  const row = await getDbDriver().get<{ s: number }>(
    `SELECT COALESCE(SUM(cost_cny), 0) AS s FROM cost_log WHERE user_id = ? AND created_at >= ?`,
    [userId, monthStartISO(testNow)],
  );
  return Math.round((Number(row?.s) || 0) * 100) / 100;
}

export interface QuotaStatus {
  tierId: string;
  usedCny: number;
  ceilingCny: number;      // -1 = 无上限
  remainingCny: number;    // Infinity 当无上限
  ratio: number;           // used / ceiling,0..(>1);无上限恒 0
  exceeded: boolean;       // 已超上限
  nearLimit: boolean;      // ≥80% 预警
  unlimited: boolean;
}

/** 纯函数:给定 used + tier 算配额状态(便于单测,不碰 DB)。 */
export function computeQuotaStatus(tierId: string, usedCny: number): QuotaStatus {
  const ceilingCny = tierMonthlyCeilingCny(tierId);
  const unlimited = ceilingCny < 0;
  if (unlimited) {
    return { tierId, usedCny, ceilingCny: -1, remainingCny: Infinity, ratio: 0, exceeded: false, nearLimit: false, unlimited: true };
  }
  const ratio = ceilingCny > 0 ? usedCny / ceilingCny : (usedCny > 0 ? Infinity : 0);
  return {
    tierId,
    usedCny,
    ceilingCny,
    remainingCny: Math.max(0, ceilingCny - usedCny),
    ratio,
    exceeded: usedCny >= ceilingCny,
    nearLimit: ratio >= 0.8,
    unlimited: false,
  };
}

/** 查某用户本月配额状态(DB)。 */
export async function checkMonthlyQuota(userId: string, tierId: string, testNow?: Date): Promise<QuotaStatus> {
  const used = await getMonthlyCostCny(userId, testNow);
  return computeQuotaStatus(tierId, used);
}
