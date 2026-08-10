/**
 * GET /api/notifications/stream (v10.2.0) — 通知实时流 (SSE)。
 *
 * 订阅当前用户的 notif 频道:有新通知(评论 @提及 / 回复)即推一帧 → 通知铃实时更新,
 * 取代固定间隔轮询。用户解析与 `/api/notifications` GET 完全一致(v12.234 起两边都要求真登录;
 * 此前文档写的「demo 兜底取最早用户」早在 v12.233 已删,注释一并更正)。25s keepalive;客户端断开 → 清理订阅。
 * 帧内只带 {type, commentId, projectId, at},不含内容;前端收到后走原有 GET 取数。
 */
import { db } from '@/lib/db';
import { createSSEResponse } from '@/lib/sse';
import { subscribe, notifChannel } from '@/lib/event-bus';
import { requireUser } from '@/lib/auth-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // v12.234:此前是 `resolveUserId()` + `if (!userId) 401` —— 而 resolveUserId 虽声明 string|null,
  // 函数体却永远返回 '__no_auth__'(truthy),那句 401 是**永不触发的死检查**。
  const _g = await requireUser(request);
  if (!_g.ok) return new Response(_g.message, { status: _g.status });
  const userId = _g.userId;

  return createSSEResponse(async (send) => {
    send({ event: 'ready', data: { ok: true } });
    const off = subscribe(notifChannel(userId), (ev) => send({ event: 'notification', data: ev }));
    const ping = setInterval(() => send({ event: 'ping', data: { at: Date.now() } }), 25_000);
    await new Promise<void>((resolve) => {
      const done = () => { clearInterval(ping); off(); resolve(); };
      if (request.signal.aborted) return done();
      request.signal.addEventListener('abort', done);
    });
  });
}
