/**
 * v12.227 — 多实例就绪回归锁。
 *
 * 侦察+对抗校验的结论:任务认领(claimNextJob/recoverOrphanJobs/claimDuePublishes)**早已用 CAS**,
 * SQLite(WAL 写锁串行)与 PG(行级锁后重估 WHERE)下都不会双拿 —— 那条不用改。
 * 真正断裂的是**进程内状态**:gate 信令、导出锁、周报幂等。本测试锁住修复后的语义。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';
import { nanoid } from 'nanoid';
import { acquireLock, releaseLock, peekLock, withLock, makeLockOwner } from '@/lib/repos/resource-lock-repo';
import { subscribe, gateChannel, emitGateResolve } from '@/lib/event-bus';

const P = 'test-v12227-';
function cleanup() {
  db.prepare(`DELETE FROM resource_locks WHERE key LIKE '${P}%'`).run();
}
beforeEach(cleanup);
afterEach(cleanup);

describe('v12.227 跨实例锁 CAS 语义', () => {
  it('首次加锁成功;同 key 第二次(他人)被拒 —— 这就是多实例下的第二个实例', async () => {
    const key = `${P}lock-${nanoid(6)}`;
    const a = makeLockOwner('instanceA');
    const b = makeLockOwner('instanceB');
    expect(await acquireLock(key, 60_000, a)).toBe(true);
    // 实例 B 的「进程内 Set」是空的,但 DB 锁挡住了它 —— 修复要害就在这
    expect(await acquireLock(key, 60_000, b)).toBe(false);
  });

  it('并发抢同一把锁:恰好一个成功(CAS 不产生双持)', async () => {
    const key = `${P}race-${nanoid(6)}`;
    const owners = Array.from({ length: 8 }, (_, i) => makeLockOwner(`i${i}`));
    const results = await Promise.all(owners.map((o) => acquireLock(key, 60_000, o)));
    expect(results.filter(Boolean).length).toBe(1);
  });

  it('释放后可再次获取', async () => {
    const key = `${P}rel-${nanoid(6)}`;
    const a = makeLockOwner('a');
    const b = makeLockOwner('b');
    expect(await acquireLock(key, 60_000, a)).toBe(true);
    expect(await releaseLock(key, a)).toBe(true);
    expect(await acquireLock(key, 60_000, b)).toBe(true);
  });

  it('只能释放自己的锁(owner 不匹配不动,防误放他人)', async () => {
    const key = `${P}own-${nanoid(6)}`;
    const a = makeLockOwner('a');
    const b = makeLockOwner('b');
    await acquireLock(key, 60_000, a);
    expect(await releaseLock(key, b)).toBe(false);   // B 放不掉 A 的锁
    expect(await acquireLock(key, 60_000, b)).toBe(false); // 锁仍在 A 手里
  });

  it('TTL 过期后可被抢占(持锁进程崩溃不会永久占锁)', async () => {
    const key = `${P}ttl-${nanoid(6)}`;
    const dead = makeLockOwner('crashed');
    // ttl 会被 clamp 到最小 1000ms,故直接把 expires_at 改成过去以模拟「已过期」
    expect(await acquireLock(key, 60_000, dead)).toBe(true);
    db.prepare(`UPDATE resource_locks SET expires_at = ? WHERE key = ?`)
      .run(new Date(Date.now() - 1000).toISOString(), key);
    const fresh = makeLockOwner('newInstance');
    expect(await acquireLock(key, 60_000, fresh)).toBe(true);
    const row = await peekLock(key);
    expect(row?.owner).toBe(fresh);
  });

  it('withLock:抢到则执行并在 finally 释放;抢不到返回 null', async () => {
    const key = `${P}with-${nanoid(6)}`;
    const held = makeLockOwner('holder');
    await acquireLock(key, 60_000, held);
    expect(await withLock(key, 60_000, async () => 'ran')).toBeNull(); // 被占 → 不执行
    await releaseLock(key, held);
    expect(await withLock(key, 60_000, async () => 'ran')).toBe('ran');
    expect(await peekLock(key)).toBeNull(); // finally 已释放
  });

  it('withLock:fn 抛错也释放锁(不留悬挂锁)', async () => {
    const key = `${P}throw-${nanoid(6)}`;
    await expect(withLock(key, 60_000, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await peekLock(key)).toBeNull();
  });
});

describe('v12.227 gate 信令走 event-bus(跨实例可达)', () => {
  it('订阅方收到放行事件 —— 这条路径不依赖进程内 activeOrchestrators', async () => {
    const projectId = `${P}proj-${nanoid(6)}`;
    const received: Array<Record<string, unknown>> = [];
    const unsub = subscribe(gateChannel(projectId), (ev) => received.push(ev as any));
    try {
      emitGateResolve(projectId, 'after-script', { action: 'edit', editedData: { title: 'X' } });
      await new Promise((r) => setTimeout(r, 10));
      expect(received.length).toBe(1);
      expect(received[0].gateId).toBe('after-script');
      expect(received[0].action).toBe('edit');
      expect((received[0].editedData as any).title).toBe('X');
    } finally { unsub(); }
  });

  it('gate 频道按 projectId 隔离(别的项目放行不会误放本项目)', async () => {
    const p1 = `${P}p1-${nanoid(6)}`;
    const p2 = `${P}p2-${nanoid(6)}`;
    const got: string[] = [];
    const unsub = subscribe(gateChannel(p1), (ev) => got.push(String(ev.gateId)));
    try {
      emitGateResolve(p2, 'after-script', { action: 'continue' });
      await new Promise((r) => setTimeout(r, 10));
      expect(got).toEqual([]);
    } finally { unsub(); }
  });

  it('action 缺省时兜底为 continue(与超时自动放行语义一致)', async () => {
    const projectId = `${P}dflt-${nanoid(6)}`;
    const got: Array<Record<string, unknown>> = [];
    const unsub = subscribe(gateChannel(projectId), (ev) => got.push(ev as any));
    try {
      emitGateResolve(projectId, 'g1', {});
      await new Promise((r) => setTimeout(r, 10));
      expect(got[0]?.action).toBe('continue');
    } finally { unsub(); }
  });

  it('projectId/gateId 缺失 → 不 emit(防脏事件污染频道)', async () => {
    const projectId = `${P}bad-${nanoid(6)}`;
    const got: unknown[] = [];
    const unsub = subscribe(gateChannel(projectId), (ev) => got.push(ev));
    try {
      emitGateResolve('', 'g1', { action: 'continue' });
      emitGateResolve(projectId, '', { action: 'continue' });
      await new Promise((r) => setTimeout(r, 10));
      expect(got).toEqual([]);
    } finally { unsub(); }
  });
});
