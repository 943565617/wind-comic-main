/**
 * POST /api/templates/[id]/rate · v9.7.16 — 用户给模板评分(1-5,去重)。
 */
import { NextResponse } from 'next/server';
import { getDbDriver } from '@/lib/db-driver';
import { getUserFromRequest } from '../../../auth/lib';
import { rateTemplate } from '@/lib/repos/template-repo';

export const runtime = 'nodejs';

async function resolveUser(request: Request): Promise<string> {
  const sub = getUserFromRequest(request)?.sub;
  if (sub) return sub;
  // v12.233(对抗复检收尾):删「无 token 回落 DB 第一个用户」——
  // 那等于匿名即以第一注册用户身份读写,且把行为记到真人头上。
  // 改哨兵:匿名请求查到的永远是空集,既不泄露也不误伤(与 v12.218 同款处理)。
  return '__no_auth__';
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { rating?: number };
  const rating = Number(body?.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'rating 需 1-5' }, { status: 400 });
  }
  const userId = await resolveUser(request);
  const agg = await rateTemplate(id, userId, rating);
  if (!agg) return NextResponse.json({ error: '模板不存在' }, { status: 404 });
  return NextResponse.json({ ok: true, ...agg, yourRating: Math.round(rating) });
}
