/**
 * v12.223 — 月度用量护栏 + 成本估算校准回归锁(🔴-6)。
 *
 * ①配额纯函数:各档月度成本上限 + exceeded/nearLimit/unlimited 语义;
 * ②4K 估算校准:videoRatePerSec 对 4K 取 std 的 6 倍(v12.215 真机 ¥6/5s=¥1.2/s);
 * ③DB 月度累计:checkMonthlyQuota 汇总 cost_log 当月真实花费。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';
import { computeQuotaStatus, tierMonthlyCeilingCny, checkMonthlyQuota, getMonthlyCostCny } from '@/lib/usage-quota';
import { videoRatePerSec, estimatePipelineCostCny } from '@/lib/budget-estimate';

describe('v12.223 配额纯函数', () => {
  it('各档月度上限', () => {
    expect(tierMonthlyCeilingCny('free')).toBe(5);
    expect(tierMonthlyCeilingCny('creator')).toBe(60);
    expect(tierMonthlyCeilingCny('pro')).toBe(200);
    expect(tierMonthlyCeilingCny('enterprise')).toBe(-1);
    expect(tierMonthlyCeilingCny('unknown-tier')).toBe(5); // 兜底 free
  });

  it('pro 档未超额', () => {
    const q = computeQuotaStatus('pro', 100);
    expect(q.ceilingCny).toBe(200);
    expect(q.exceeded).toBe(false);
    expect(q.nearLimit).toBe(false);
    expect(q.remainingCny).toBe(100);
    expect(q.ratio).toBeCloseTo(0.5, 5);
  });

  it('pro 档接近上限(≥80%)', () => {
    const q = computeQuotaStatus('pro', 170);
    expect(q.nearLimit).toBe(true);
    expect(q.exceeded).toBe(false);
  });

  it('pro 档超额', () => {
    const q = computeQuotaStatus('pro', 250);
    expect(q.exceeded).toBe(true);
    expect(q.remainingCny).toBe(0);
    expect(q.ratio).toBeGreaterThan(1);
  });

  it('企业档无上限', () => {
    const q = computeQuotaStatus('enterprise', 99999);
    expect(q.unlimited).toBe(true);
    expect(q.exceeded).toBe(false);
    expect(q.remainingCny).toBe(Infinity);
  });
});

describe('v12.223 4K 估算校准', () => {
  it('kling 4K 单价约 std 的 6 倍(≈¥1.2/s)', () => {
    const std = videoRatePerSec('kling', 'std');
    const p4k = videoRatePerSec('kling', '4k');
    expect(std).toBeCloseTo(0.2, 5);
    expect(p4k).toBeCloseTo(1.2, 5);
    expect(p4k / std).toBeCloseTo(6, 5);
  });

  it('pro 档 2 倍、未知 mode 按 std', () => {
    expect(videoRatePerSec('kling', 'pro')).toBeCloseTo(0.4, 5);
    expect(videoRatePerSec('kling', 'weird')).toBeCloseTo(0.2, 5);
    expect(videoRatePerSec('kling', null)).toBeCloseTo(0.2, 5);
  });

  it('整片估算:4K 显著高于 std(不再低估)', () => {
    const std = estimatePipelineCostCny({ shotCount: 10, videoProvider: 'kling', secondsPerShot: 5, mode: 'std' });
    const p4k = estimatePipelineCostCny({ shotCount: 10, videoProvider: 'kling', secondsPerShot: 5, mode: '4k' });
    expect(p4k).toBeGreaterThan(std * 3); // 视频部分 6 倍,含固定图/音项后仍应 >3x
  });
});

describe('v12.223 DB 月度累计', () => {
  const U = 'test-v12223-quota-user';
  function seedCost(cny: number, whenISO: string) {
    db.prepare(
      `INSERT INTO cost_log (id, user_id, project_id, engine, resolution, duration_sec, cost_cny, created_at)
       VALUES (?, ?, 'p', 'kling', '4k', 5, ?, ?)`,
    ).run('cl_' + Math.random().toString(36).slice(2), U, cny, whenISO);
  }
  beforeEach(() => {
    db.prepare(`DELETE FROM cost_log WHERE user_id = ?`).run(U);
    db.prepare(
      `INSERT OR IGNORE INTO users (id, email, password_hash, name, role, locale, created_at)
       VALUES (?, ?, '', 'quota', 'user', 'zh', ?)`,
    ).run(U, `${U}@test.local`, new Date().toISOString());
  });
  afterEach(() => {
    db.prepare(`DELETE FROM cost_log WHERE user_id = ?`).run(U);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(U);
  });

  it('getMonthlyCostCny 只汇总当月(排除上月)', async () => {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15).toISOString();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString();
    seedCost(30, thisMonth);
    seedCost(12, thisMonth);
    seedCost(999, lastMonth); // 上月不计入
    const used = await getMonthlyCostCny(U);
    expect(used).toBeCloseTo(42, 2);
  });

  it('checkMonthlyQuota:pro 用户本月花 210 → 超额', async () => {
    const thisMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 10).toISOString();
    seedCost(210, thisMonth);
    const q = await checkMonthlyQuota(U, 'pro');
    expect(q.usedCny).toBeCloseTo(210, 2);
    expect(q.exceeded).toBe(true);
  });
});
