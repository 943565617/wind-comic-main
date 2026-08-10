/**
 * v9.3.4 — lib/budget-enforce 单测 (用户预算持久化 + 当月花费 + assertBudget 裁决).
 * 用真 SQLite 种 user(含 budget 列) + cost_log。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';
import { getUserBudget, setUserBudget, monthSpentCny, assertBudget } from '@/lib/budget-enforce';

const U = 'bg_test_user';
let _n = 0;

function seedUser() {
  db.prepare(
    `INSERT OR REPLACE INTO users (id, email, password_hash, name, role, created_at) VALUES (?,?,?,?,?,?)`,
  ).run(U, `${U}@x.com`, 'h', 'T', 'creator', new Date().toISOString());
}
function seedCost(cost: number, when: string) {
  db.prepare(
    `INSERT INTO cost_log (id, user_id, project_id, engine, resolution, duration_sec, cost_cny, metadata, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(`bgc_${++_n}`, U, 'p', 'kling3', '720p', 5, cost, '{}', when);
}
function clean() {
  db.prepare('DELETE FROM cost_log WHERE user_id = ?').run(U);
  db.prepare('DELETE FROM users WHERE id = ?').run(U);
}

beforeEach(() => { clean(); seedUser(); });
afterEach(() => { clean(); });

describe('v9.3.4 · budget-enforce', () => {
  it('setUserBudget / getUserBudget 往返; 清除自设后回落订阅档位上限', async () => {
    await setUserBudget(U, { capCny: 100, hardCapCny: 150 });
    expect(await getUserBudget(U)).toEqual({ capCny: 100, hardCapCny: 150 });
    // v12.232 行为变更:清掉自设 cap 后**不再是"不设防"**,而是回落到订阅档位上限。
    // 旧断言(capCny: null)锁的其实是缺陷 —— 那正是「档位上限从不执法」的根因。
    // 测试用户是 free 档 → 回落 ¥5。
    await setUserBudget(U, { capCny: null });
    expect(await getUserBudget(U)).toEqual({ capCny: 5, hardCapCny: null });
    await setUserBudget(U, { capCny: 0 });
    expect((await getUserBudget(U)).capCny).toBe(5);
  });

  it('monthSpentCny 只算当月, 跨月不计', async () => {
    const now = new Date();
    seedCost(3, now.toISOString());
    seedCost(2, now.toISOString());
    seedCost(99, new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString()); // 去年同月
    expect(await monthSpentCny(U, now)).toBe(5);
  });

  it('assertBudget: 未自设预算 → 用档位上限裁决(free ¥5),零花费时 ok 放行', async () => {
    // v12.232:此前这里断言 level='none'(无上限、永远放行)—— 那是缺陷行为。
    // 现在 free 档回落 ¥5 上限,零花费自然 ok。
    const r = await assertBudget({ userId: U });
    expect(r.allow).toBe(true);
    expect(r.guard.level).toBe('ok');
  });

  it('v12.232: free 档未自设预算,花费超档位上限 → 真的被拦(档位上限首次具备执法力)', async () => {
    seedCost(20, new Date().toISOString());   // free 档上限 ¥5,花 ¥20
    const r = await assertBudget({ userId: U });
    expect(r.allow).toBe(false);
  });

  it('v12.232: 企业档(-1 无上限)仍不设防', async () => {
    db.prepare('UPDATE users SET subscription_tier = ? WHERE id = ?').run('enterprise', U);
    const r = await assertBudget({ userId: U });
    expect(r.guard.level).toBe('none');
    db.prepare('UPDATE users SET subscription_tier = ? WHERE id = ?').run('free', U);
  });

  it('assertBudget: 花费低于阈值 → ok 放行', async () => {
    await setUserBudget(U, { capCny: 100 });
    seedCost(30, new Date().toISOString());
    const r = await assertBudget({ userId: U });
    expect(r.allow).toBe(true);
    expect(r.guard.level).toBe('ok');
  });

  it('assertBudget: 当月已达硬上限(软=硬) → hard_block 拦', async () => {
    await setUserBudget(U, { capCny: 50 });
    seedCost(50, new Date().toISOString());
    const r = await assertBudget({ userId: U });
    expect(r.allow).toBe(false);
    expect(r.guard.level).toBe('hard_block');
  });

  it('assertBudget: pending 会越硬上限 → 拦', async () => {
    await setUserBudget(U, { capCny: 100, hardCapCny: 100 });
    seedCost(90, new Date().toISOString());
    const r = await assertBudget({ userId: U, pendingCostCny: 20 }); // 90+20=110 > 100
    expect(r.allow).toBe(false);
    expect(r.guard.projectedAfterCny).toBe(110);
  });
});
