import { NextRequest, NextResponse } from 'next/server';
import { activeOrchestrators } from '../route';
import { emitGateResolve } from '@/lib/event-bus';
import { requireProjectAccess } from '@/lib/auth-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 人工闸门放行。
 *
 * v12.227(多实例就绪):原实现只在 `activeOrchestrators`(**进程内** Map)里按 projectId
 * 找编排器,找不到就 404。多实例部署下流水线跑在实例 A,而这个 POST 可能被负载均衡打到
 * 实例 B —— B 的 Map 是空的 → 恒 404,**流水线一直挂在 waitForGate 直到 5 分钟超时自动放行**,
 * 用户点多少次「审核通过」都毫无反应,也没有任何提示能解释原因。
 *
 * 现在改为向 event-bus 的 gate 频道 emit:
 *   - 单机(未配 REDIS_URL):总线就是同进程 EventEmitter,emit 即达 —— 与原先零行为差异;
 *   - 多实例(配了 REDIS_URL):经既有 Redis 桥自动投递到编排器所在实例。
 *
 * `localHit` 仅用于回执里告知「本实例确实持有该编排器」,便于排障;
 * 即便为 false 也照常 emit —— 多实例下这才是常态,不能再据此 404。
 */
export async function POST(request: NextRequest) {
  const { projectId, gateId, action, editedData } = await request.json();

  if (!projectId || !gateId) {
    return NextResponse.json({ error: 'projectId and gateId are required' }, { status: 400 });
  }

  // v12.231(对抗复检补漏):v12.227 我改这个文件做多实例信令时**没加鉴权** ——
  // 任何人知道 projectId 即可放行他人流水线的人工审核门(绕过 enableGates)。
  // 放行属写操作,要 edit 级。
  const g = await requireProjectAccess(request, projectId, 'edit');
  if (!g.ok) return NextResponse.json({ message: g.message }, { status: g.status });

  const localHit = activeOrchestrators.has(projectId);
  emitGateResolve(projectId, gateId, { action, editedData });

  return NextResponse.json({ ok: true, localHit });
}
