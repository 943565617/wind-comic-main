/**
 * GET /api/preview-shot/history?limit=30 · v2.18 P2.2
 * DELETE /api/preview-shot/history?id=xxx — 删除某条历史
 *
 * 当前用户的试拍历史 (按 created_at DESC). 同时返回当天 quota 状态供 UI 显示。
 *
 * 出参:
 *   200 → { entries: PreviewHistoryEntry[], quota: { tier, used, limit, remaining } }
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../../auth/lib';
import { getQuotaState, listForUser, deletePreview, type Tier } from '@/lib/preview-history';
import { checkPlan } from '@/lib/plan-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveUserId(request: Request): string {
  const payload = getUserFromRequest(request);
  if (payload?.sub) return payload.sub;
  // v12.233(对抗复检收尾):删「无 token 回落 DB 第一个用户」——
  // 那等于匿名即以第一注册用户身份读写,且把行为记到真人头上。
  // 改哨兵:匿名请求查到的永远是空集,既不泄露也不误伤(与 v12.218 同款处理)。
  return '__no_auth__';
}

export async function GET(request: NextRequest) {
  const userId = resolveUserId(request);
  const limit = Number(request.nextUrl.searchParams.get('limit') || 30);

  const tierProbe = checkPlan(request, 'free');
  const tier: Tier = (tierProbe.current as Tier) || 'free';

  const entries = await listForUser(userId, limit);
  const quota = await getQuotaState(userId, tier);

  return NextResponse.json({
    entries,
    quota,
  });
}

export async function DELETE(request: NextRequest) {
  const userId = resolveUserId(request);
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: '缺 id' }, { status: 400 });
  const ok = await deletePreview(id, userId);
  if (!ok) return NextResponse.json({ error: '记录不存在或不属于当前用户' }, { status: 404 });
  return NextResponse.json({ deleted: true, id });
}
