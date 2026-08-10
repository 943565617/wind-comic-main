/**
 * v12.227 — 跨实例互斥锁(带 TTL,双驱动)。
 *
 * 病根(多实例就绪):长任务的并发防重此前用**进程内** Set/Map —— 典型是系列导出的
 * `inFlight: Set<string>`。多实例下第二个实例的 Set 是空的,`if (inFlight.has(id))` 形同虚设,
 * 同一系列会被两个 ffmpeg 同时导出:产物互相覆盖(最终 season_video 指向谁是竞争结果)、
 * CPU/磁盘双份消耗。
 *
 * 为什么用 DB 而不是 Redis:**DB 本来就是多实例共享的**,零新依赖;CAS 语义与
 * `claimNextJob` 完全一致(原子 UPDATE/INSERT + 检查 changes),两个驱动都天然支持。
 * 单机部署行为与原 Set 等价 —— 拿不到锁同样返回 false。
 *
 * TTL 是防死锁兜底:持锁进程崩溃/被 kill 不会永久占锁,过期后自动可被抢占。
 */
import { getDbDriver } from '../db-driver';

/** 锁持有者标识:进程内唯一即可(用于释放时校验,防误放他人的锁)。 */
export function makeLockOwner(tag = ''): string {
  return `${process.pid}:${Math.random().toString(36).slice(2, 10)}${tag ? ':' + tag : ''}`;
}

/**
 * 尝试获取锁。成功 true,已被他人持有且未过期 false。
 *
 * 两步都是原子 CAS,任一步成功即持锁:
 *   ① UPDATE ... WHERE key=? AND expires_at <= now —— 抢占**已过期**的锁(含自己上轮遗留的);
 *   ② INSERT (OR IGNORE / ON CONFLICT DO NOTHING) —— 该 key 从未有过行时插入。
 * 两实例并发:①都 0 changes(无行或未过期)→ ②只有一个能插进去,另一个 0 changes → false。
 */
export async function acquireLock(key: string, ttlMs: number, owner: string): Promise<boolean> {
  const drv = getDbDriver();
  const now = new Date();
  const nowIso = now.toISOString();
  const expIso = new Date(now.getTime() + Math.max(1000, ttlMs)).toISOString();

  // ① 抢占过期锁
  const upd = await drv.run(
    `UPDATE resource_locks SET owner = ?, expires_at = ?, created_at = ? WHERE key = ? AND expires_at <= ?`,
    [owner, expIso, nowIso, key, nowIso],
  );
  if (upd.changes) return true;

  // ② 首次加锁
  const insertSql = drv.dialect === 'postgres'
    ? `INSERT INTO resource_locks (key, owner, expires_at, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO NOTHING`
    : `INSERT OR IGNORE INTO resource_locks (key, owner, expires_at, created_at) VALUES (?, ?, ?, ?)`;
  try {
    const ins = await drv.run(insertSql, [key, owner, expIso, nowIso]);
    if (ins.changes) return true;
  } catch {
    // 并发插入撞主键 —— 视同没抢到
  }
  return false;
}

/** 释放锁(只释放自己持有的那把;owner 不匹配则不动,防误放)。 */
export async function releaseLock(key: string, owner: string): Promise<boolean> {
  const r = await getDbDriver().run(`DELETE FROM resource_locks WHERE key = ? AND owner = ?`, [key, owner]);
  return Boolean(r.changes);
}

/** 查锁当前状态(排障/测试用)。 */
export async function peekLock(key: string): Promise<{ key: string; owner: string; expires_at: string } | null> {
  return getDbDriver().get(`SELECT key, owner, expires_at FROM resource_locks WHERE key = ?`, [key]);
}

/**
 * 便捷包装:拿到锁则执行 fn 并在 finally 释放;拿不到返回 null。
 * 注意 fn 抛错时锁照常释放(finally),不会留下悬挂锁。
 */
export async function withLock<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  owner: string = makeLockOwner(),
): Promise<T | null> {
  if (!(await acquireLock(key, ttlMs, owner))) return null;
  try {
    return await fn();
  } finally {
    await releaseLock(key, owner).catch(() => { /* 释放失败靠 TTL 兜底 */ });
  }
}
