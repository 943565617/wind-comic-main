/**
 * v3.0 P0.1 — Notifications API.
 *
 * GET /api/notifications?unread=1&limit=N
 *   → { notifications: NotificationRow[], unreadCount: number }
 *
 * POST /api/notifications  body: { action: 'markRead', id?: string }  (id 不传 = markAllRead)
 *   → { updated: N }
 *
 * 鉴权: 都要登录, 按 recipient_user_id 严格隔离.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth-guard';
import { db } from '@/lib/db';
// v4.2.5: 读 + 写全走 async repo (DbDriver 双驱动), 不再依赖同步 lib/notifications
import {
  listNotifications,
  countUnread as countUnreadAsync,
  markRead,
  markAllRead,
} from '@/lib/repos/notification-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // v12.234:此前是 `resolveUserId()` + `if (!userId) 401` —— 而 resolveUserId 虽声明 string|null,
  // 函数体却永远返回 '__no_auth__'(truthy),那句 401 是**永不触发的死检查**。
  // 类型签名说了谎,读代码的人(包括我自己)就以为这里有守卫。改用真守卫。
  // (哨兵在此只会查到空通知列表,不泄露;但死检查会让人误以为已鉴权。)
  const _g = await requireUser(request);
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });
  const userId = _g.userId;

  // v10.5.4 懒 digest:拉通知时顺手检查 —— ≥7 天且本周有创作活动才发周报(fire-and-forget)
  void import('@/lib/weekly-digest').then(({ maybeSendWeeklyDigest }) => maybeSendWeeklyDigest(userId)).catch(() => {});

  const unreadOnly = request.nextUrl.searchParams.get('unread') === '1';
  const limitStr = request.nextUrl.searchParams.get('limit');
  const limit = limitStr ? parseInt(limitStr, 10) : 30;

  const notifications = await listNotifications(userId, { unreadOnly, limit });
  const unreadCount = await countUnreadAsync(userId);

  return NextResponse.json({ notifications, unreadCount });
}

export async function POST(request: NextRequest) {
  // v12.234:此前是 `resolveUserId()` + `if (!userId) 401` —— 而 resolveUserId 虽声明 string|null,
  // 函数体却永远返回 '__no_auth__'(truthy),那句 401 是**永不触发的死检查**。
  // 类型签名说了谎,读代码的人(包括我自己)就以为这里有守卫。改用真守卫。
  // (哨兵在此只会查到空通知列表,不泄露;但死检查会让人误以为已鉴权。)
  const _g = await requireUser(request);
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });
  const userId = _g.userId;

  let body: any = {};
  try { body = await request.json(); } catch { /* allow empty body for markAllRead */ }

  const action = String(body?.action || 'markRead');
  if (action !== 'markRead' && action !== 'markAllRead') {
    return NextResponse.json({ error: `invalid action: ${action}` }, { status: 400 });
  }

  if (action === 'markAllRead' || !body?.id) {
    const n = await markAllRead(userId);
    return NextResponse.json({ updated: n });
  }

  const id = String(body.id);
  const ok = await markRead(id, userId);
  return NextResponse.json({ updated: ok ? 1 : 0 });
}
