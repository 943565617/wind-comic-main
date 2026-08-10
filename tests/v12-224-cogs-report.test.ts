/**
 * v12.224 — 单片 COGS 报告回归锁(🔴-6 尾:投资人要真实 COGS + 毛利)。
 *
 * ①纯函数 buildCogsReport:逐引擎单价(¥/秒 或 ¥/次)× 用量 → 小计/占比/总 COGS + 毛利率;
 * ②路由 ?report=cogs:数字与 cost_log 一致(不重估,用真实记账);?sale=X 出毛利。
 * 复算样本用 kling-full 的真实结构(24 图 ¥7.2 + 4 视频 32s ¥6.4 = ¥13.6),锁「与账一致」。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';
import { nanoid } from 'nanoid';
import { signToken } from '@/app/api/auth/lib';
import { buildCogsReport } from '@/lib/cogs-report';
import { GET as getCost } from '@/app/api/projects/[id]/cost/route';

describe('v12.224 buildCogsReport 纯函数', () => {
  const rollups = [
    { engine: 'video-kling', count: 4, costCny: 6.4, durationSecTotal: 32 },
    { engine: 'image', count: 24, costCny: 7.2, durationSecTotal: 0 },
  ];

  it('视频引擎 per_sec 单价 = ¥0.2/秒', () => {
    const r = buildCogsReport(rollups);
    const v = r.lines.find((l) => l.engine === 'video-kling')!;
    expect(v.unit).toBe('per_sec');
    expect(v.unitRateCny).toBeCloseTo(0.2, 5);
    expect(v.subtotalCny).toBeCloseTo(6.4, 5);
  });

  it('图像引擎 per_call 单价 = ¥0.3/次', () => {
    const r = buildCogsReport(rollups);
    const img = r.lines.find((l) => l.engine === 'image')!;
    expect(img.unit).toBe('per_call');
    expect(img.unitRateCny).toBeCloseTo(0.3, 5);
  });

  it('总 COGS = ¥13.6,占比合计 ≈ 100', () => {
    const r = buildCogsReport(rollups);
    expect(r.totalCogsCny).toBeCloseTo(13.6, 5);
    const pctSum = r.lines.reduce((t, l) => t + l.pct, 0);
    expect(pctSum).toBeGreaterThan(99);
    expect(pctSum).toBeLessThan(101);
  });

  it('给参考售价 → 毛利率', () => {
    const r = buildCogsReport(rollups, { saleCny: 30 });
    expect(r.margin).toBeTruthy();
    expect(r.margin!.grossProfitCny).toBeCloseTo(16.4, 5);
    expect(r.margin!.grossMarginPct).toBeCloseTo(54.7, 1);
  });

  it('不给售价 → margin 为 null', () => {
    expect(buildCogsReport(rollups).margin).toBeNull();
  });
});

describe('v12.224 路由 ?report=cogs 与 cost_log 一致', () => {
  const P = 'test-v12224-cogs-';
  let owner = '';
  let projId = '';
  function tok(id: string) { return signToken({ id, role: 'user' }); }
  function seedCost(engine: string, resolution: string, sec: number, cny: number) {
    db.prepare(
      `INSERT INTO cost_log (id, user_id, project_id, engine, resolution, duration_sec, cost_cny, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('cl_' + nanoid(10), owner, projId, engine, resolution, sec, cny, new Date().toISOString());
  }
  beforeEach(() => {
    owner = `${P}u-${nanoid(6)}`;
    projId = `${P}p-${nanoid(6)}`;
    db.prepare(`INSERT INTO users (id, email, password_hash, name, role, locale, created_at) VALUES (?, ?, '', 'o', 'user', 'zh', ?)`)
      .run(owner, `${owner}@t.local`, new Date().toISOString());
    db.prepare(`INSERT INTO projects (id, user_id, title, description, cover_urls, status, created_at, updated_at) VALUES (?, ?, 'c', 'd', '[]', 'draft', ?, ?)`)
      .run(projId, owner, new Date().toISOString(), new Date().toISOString());
    seedCost('video-kling', '4k', 32, 6.4);
    seedCost('image', '1024', 0, 7.2);
  });
  afterEach(() => {
    db.prepare(`DELETE FROM cost_log WHERE project_id LIKE '${P}%'`).run();
    db.prepare(`DELETE FROM projects WHERE id LIKE '${P}%'`).run();
    db.prepare(`DELETE FROM users WHERE id LIKE '${P}%'`).run();
  });

  it('属主 GET ?report=cogs → totalCogsCny 与 cost_log 合计一致', async () => {
    const req = new Request(`http://localhost/api/projects/${projId}/cost?report=cogs`, {
      headers: { authorization: `Bearer ${tok(owner)}` },
    });
    const res = await getCost(req, { params: Promise.resolve({ id: projId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalCogsCny).toBeCloseTo(13.6, 5);
    expect(body.lines.length).toBe(2);
  });

  it('?report=cogs&sale=30 → 毛利率', async () => {
    const req = new Request(`http://localhost/api/projects/${projId}/cost?report=cogs&sale=30`, {
      headers: { authorization: `Bearer ${tok(owner)}` },
    });
    const res = await getCost(req, { params: Promise.resolve({ id: projId }) });
    const body = await res.json();
    expect(body.margin.saleCny).toBe(30);
    expect(body.margin.grossProfitCny).toBeCloseTo(16.4, 5);
  });

  it('无 token → 401(成本敏感)', async () => {
    const req = new Request(`http://localhost/api/projects/${projId}/cost?report=cogs`);
    const res = await getCost(req, { params: Promise.resolve({ id: projId }) });
    expect(res.status).toBe(401);
  });
});
