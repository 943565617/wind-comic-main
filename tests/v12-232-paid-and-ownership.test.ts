/**
 * v12.232 — 付费端点守卫 + 角色归属 + 档位上限执法 回归锁。
 *
 * 起因:v12.231 收官时跑独立对抗复检,推翻了我自己「已堵」的结论。本版修其中最紧的三项。
 * 这里锁的是**真行为**:铸真 JWT 调真 handler、真的把花费写进 cost_log 看拦不拦。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';
import { nanoid } from 'nanoid';
import { signToken } from '@/app/api/auth/lib';
import { getUserBudget, assertBudget, setUserBudget } from '@/lib/budget-enforce';
import { guardPaidEndpoint } from '@/lib/paid-endpoint-guard';
import { GET as charGet, PUT as charPut, DELETE as charDel } from '@/app/api/characters/[id]/route';

const P = 'test-v12232-';
let owner = '';
let other = '';
let charId = '';

function tok(id: string) { return signToken({ id, role: 'user' }); }
function req(token?: string, body?: any): any {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  headers.set('content-type', 'application/json');
  return new Request('http://localhost/api/x', {
    method: body ? 'PUT' : 'GET', headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
function mkUser(tag: string, tier = 'free') {
  const id = `${P}${tag}-${nanoid(6)}`;
  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, locale, subscription_tier, created_at)
     VALUES (?, ?, '', ?, 'user', 'zh', ?, ?)`,
  ).run(id, `${id}@t.local`, tag, tier, new Date().toISOString());
  return id;
}
function cleanup() {
  db.prepare(`DELETE FROM cost_log WHERE user_id LIKE '${P}%'`).run();
  db.prepare(`DELETE FROM character_library WHERE id LIKE '${P}%' OR user_id LIKE '${P}%'`).run();
  db.prepare(`DELETE FROM users WHERE id LIKE '${P}%'`).run();
}

beforeEach(() => {
  cleanup();
  owner = mkUser('owner');
  other = mkUser('other');
  charId = `${P}char-${nanoid(6)}`;
  db.prepare(
    `INSERT INTO character_library (id, user_id, name, description, appearance, visual_tags, image_urls, style_keywords, usage_count, created_at, updated_at)
     VALUES (?, ?, '林小满', 'd', 'a', '[]', '[]', '', 0, ?, ?)`,
  ).run(charId, owner, new Date().toISOString(), new Date().toISOString());
});
afterEach(cleanup);

const params = () => ({ params: Promise.resolve({ id: charId }) });

describe('v12.232 characters/[id] 归属收口', () => {
  it('GET 无 token → 401(此前零鉴权,知道 id 即可读全部字段)', async () => {
    const res = await charGet(req() as any, params());
    expect(res.status).toBe(401);
  });

  it('GET 他人 token → 404(不用 403,避免泄露"该 id 存在")', async () => {
    const res = await charGet(req(tok(other)) as any, params());
    expect(res.status).toBe(404);
  });

  it('GET 属主 → 200', async () => {
    const res = await charGet(req(tok(owner)) as any, params());
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe('林小满');
  });

  it('PUT 无 token → 401(此前回落 DB 第一个用户,匿名即可改)', async () => {
    const res = await charPut(req(undefined, { name: 'hacked' }) as any, params());
    expect(res.status).toBe(401);
    const row = db.prepare('SELECT name FROM character_library WHERE id = ?').get(charId) as any;
    expect(row.name).toBe('林小满'); // 确认真的没被改
  });

  it('PUT 他人 token → 404(此前拿到 row 后从不比对 user_id)', async () => {
    const res = await charPut(req(tok(other), { name: 'hacked' }) as any, params());
    expect(res.status).toBe(404);
    const row = db.prepare('SELECT name FROM character_library WHERE id = ?').get(charId) as any;
    expect(row.name).toBe('林小满');
  });

  it('DELETE 无 token → 401 且角色仍在(此前匿名可删任意角色)', async () => {
    const res = await charDel(req() as any, params());
    expect(res.status).toBe(401);
    expect(db.prepare('SELECT id FROM character_library WHERE id = ?').get(charId)).toBeTruthy();
  });

  it('DELETE 他人 token → 404 且角色仍在', async () => {
    const res = await charDel(req(tok(other)) as any, params());
    expect(res.status).toBe(404);
    expect(db.prepare('SELECT id FROM character_library WHERE id = ?').get(charId)).toBeTruthy();
  });
});

describe('v12.232 付费端点守卫', () => {
  it('无 token → 401(不进入任何付费调用)', async () => {
    const g = await guardPaidEndpoint(req());
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.response.status).toBe(401);
  });

  it('已登录且未超额 → 放行并给出 userId', async () => {
    const g = await guardPaidEndpoint(req(tok(owner)), { pendingCostCny: 0.1 });
    expect(g.ok).toBe(true);
    if (g.ok) expect(g.userId).toBe(owner);
  });

  it('已登录但超档位上限 → 402(free 档 ¥5,已花 ¥20)', async () => {
    db.prepare(
      `INSERT INTO cost_log (id, user_id, project_id, engine, resolution, duration_sec, cost_cny, created_at)
       VALUES (?, ?, NULL, 'kling', '1080p', 5, 20, ?)`,
    ).run('cl_' + nanoid(8), owner, new Date().toISOString());
    const g = await guardPaidEndpoint(req(tok(owner)), { pendingCostCny: 1.8 });
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.response.status).toBe(402);
  });
});

describe('v12.232 档位上限首次具备执法力', () => {
  it('未自设预算 → 回落订阅档位上限(free ¥5),不再是"不设防"', async () => {
    expect((await getUserBudget(owner)).capCny).toBe(5);
  });

  it('自设预算优先于档位上限', async () => {
    await setUserBudget(owner, { capCny: 100 });
    expect((await getUserBudget(owner)).capCny).toBe(100);
  });

  it('pro 档回落 ¥200', async () => {
    const pro = mkUser('pro', 'pro');
    expect((await getUserBudget(pro)).capCny).toBe(200);
  });

  it('企业档(-1)仍不设防', async () => {
    const ent = mkUser('ent', 'enterprise');
    expect((await getUserBudget(ent)).capCny).toBeNull();
    expect((await assertBudget({ userId: ent })).guard.level).toBe('none');
  });

  it('free 档花超 ¥5 → assertBudget 真的拦(此前永远放行)', async () => {
    db.prepare(
      `INSERT INTO cost_log (id, user_id, project_id, engine, resolution, duration_sec, cost_cny, created_at)
       VALUES (?, ?, NULL, 'kling', '1080p', 5, 30, ?)`,
    ).run('cl_' + nanoid(8), owner, new Date().toISOString());
    expect((await assertBudget({ userId: owner })).allow).toBe(false);
  });
});
