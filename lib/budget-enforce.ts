/**
 * lib/budget-enforce (v9.3.4) — 预算护栏服务端强制: 读用户预算 + 当月花费 → 裁决.
 *
 * 把 v9.3.3 的纯逻辑 evaluateBudgetGuard 接到服务端真实数据:
 *   - 用户预算: users.budget_cap_cny / budget_hard_cap_cny (v9.3.4 加列, null = 不设防)
 *   - 当月花费: cost_log 当月该用户 SUM(cost_cny)
 * 生成端点调 assertBudget() → 到硬上限拦截 (preview-shot 起接, 核心管线留后续)。
 *
 * 走 DbDriver 双驱动 (SQLite/PG); now 可注入保持可测。
 * 单测 tests/v9-3-4-budget-enforce.test.ts。
 */

import { getDbDriver } from './db-driver';
import { evaluateBudgetGuard, type BudgetGuardResult } from './budget-guard';

export interface UserBudget {
  capCny: number | null;
  hardCapCny: number | null;
}

/**
 * 读用户月预算 (软/硬上限)。
 *
 * v12.232(对抗复检补漏 —— 这是整轮加固最尴尬的一处):
 * v12.223 建了订阅档位月度成本上限(免费 5 / 创作 60 / 专业 200),写了纯函数、写了单测、
 * 还做了 UI 配额环 —— **唯独没接进 assertBudget**。而 assertBudget 只认 `users.budget_cap_cny`,
 * 该列默认 null → `assertBudget` 直接放行(见下方 line 66 的早退)。
 * 结果:**档位上限从头到尾没拦住过任何一次调用**,「有单测、有 UI、就是不执法」。
 *
 * 现在:用户没自设 cap 时,**回落到其订阅档位上限**。语义上也更对 ——
 * 档位上限是平台侧的兜底约束,用户自设的 cap 是在此之上的自我约束(取更严的那个)。
 * 企业档(-1 无上限)与未知档仍回落 null(不设防),保持既有行为。
 */
export async function getUserBudget(userId: string): Promise<UserBudget> {
  const row = (await getDbDriver().get(
    'SELECT budget_cap_cny, budget_hard_cap_cny, subscription_tier FROM users WHERE id = ?',
    [userId],
  )) as { budget_cap_cny: number | null; budget_hard_cap_cny: number | null; subscription_tier?: string | null } | undefined;

  const selfCap = row?.budget_cap_cny != null ? Number(row.budget_cap_cny) : null;
  let capCny = selfCap;
  if (capCny == null) {
    // v12.234(二轮对抗复检 · 根因):此处原写 `if (capCny == null && row)`。那个 `&& row` 是致命的 ——
    // **查不到用户时反而完全不设防**:row=undefined → 跳过回落 → capCny 保持 null →
    // assertBudget 的 `capCny == null` 分支直接 allow:true,连本月已花多少都不查。
    // 而 `'__no_auth__'` 这个匿名哨兵在 20+ 路由里用,它永远查不到 DB 行 ——
    // 等于「匿名 = 无限额度」,把刚建的预算护栏在匿名场景下整个架空。
    // 现在:查不到行 → 按 free 档兜底(最严),而不是按「不设防」兜底。护栏要 fail-closed。
    const { tierMonthlyCeilingCny } = await import('./usage-quota');
    const tierCap = tierMonthlyCeilingCny(row?.subscription_tier || 'free');
    if (tierCap > 0) capCny = tierCap;   // -1(企业)= 显式不设防,保持 null
  }
  return {
    capCny,
    hardCapCny: row?.budget_hard_cap_cny != null ? Number(row.budget_hard_cap_cny) : null,
  };
}

/** 设用户月预算; capCny/hardCapCny 传 null 即清除(不设防)。 */
export async function setUserBudget(
  userId: string,
  b: { capCny: number | null; hardCapCny?: number | null },
): Promise<void> {
  const cap = b.capCny != null && Number.isFinite(b.capCny) && b.capCny > 0 ? Number(b.capCny) : null;
  const hard = b.hardCapCny != null && Number.isFinite(b.hardCapCny) && b.hardCapCny > 0 ? Number(b.hardCapCny) : null;
  await getDbDriver().run(
    'UPDATE users SET budget_cap_cny = ?, budget_hard_cap_cny = ? WHERE id = ?',
    [cap, hard, userId],
  );
}

/** 当月该用户 cost_log 花费 (CNY)。 */
export async function monthSpentCny(userId: string, now: Date = new Date()): Promise<number> {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const row = (await getDbDriver().get(
    'SELECT COALESCE(SUM(cost_cny), 0) AS spent FROM cost_log WHERE user_id = ? AND created_at >= ?',
    [userId, monthStart],
  )) as { spent: number | string } | undefined;
  return Number(row?.spent ?? 0);
}

/**
 * 生成前置护栏: 读预算 + 当月花费 → evaluateBudgetGuard 裁决。
 * 无预算上限 → 永远放行 (level 'none')。pendingCostCny = 本次操作预估成本。
 */
export async function assertBudget(
  opts: { userId: string; pendingCostCny?: number },
  now: Date = new Date(),
): Promise<{ allow: boolean; guard: BudgetGuardResult }> {
  const { capCny, hardCapCny } = await getUserBudget(opts.userId);
  // 无软上限直接放行, 省一次花费查询
  if (capCny == null || capCny <= 0) {
    const guard = evaluateBudgetGuard({ spentCny: 0, capCny: null, pendingCostCny: opts.pendingCostCny });
    return { allow: true, guard };
  }
  const spentCny = await monthSpentCny(opts.userId, now);
  const guard = evaluateBudgetGuard({ spentCny, capCny, hardCapCny, pendingCostCny: opts.pendingCostCny });
  return { allow: guard.allow, guard };
}
