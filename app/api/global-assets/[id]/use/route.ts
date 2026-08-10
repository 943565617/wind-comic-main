/**
 * POST /api/global-assets/[id]/use
 *
 * 记录 projectId 使用了该全局资产（去重累加到 referenced_by_projects）。
 * 用于将来的热度统计 / "已被 X 个项目使用" 徽标。
 *
 * body: { projectId: string }
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../../../auth/lib';
import { recordAssetUsage } from '@/lib/repos/global-asset-repo'; // v9.0.3b: async, 双驱动

export const runtime = 'nodejs';

function resolveUserId(request: Request): string {
  const payload = getUserFromRequest(request);
  if (payload?.sub) return payload.sub;
  // v12.233(对抗复检收尾):删「无 token 回落 DB 第一个用户」——
  // 那等于匿名即以第一注册用户身份读写,且把行为记到真人头上。
  // 改哨兵:匿名请求查到的永远是空集,既不泄露也不误伤(与 v12.218 同款处理)。
  return '__no_auth__';
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = resolveUserId(request);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { projectId?: string };
    if (!body.projectId || String(body.projectId).trim().length === 0) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    const updated = await recordAssetUsage(id, userId, String(body.projectId));
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({
      success: true,
      id: updated.id,
      referencedByProjects: updated.referencedByProjects,
    });
  } catch (e) {
    if (e instanceof Error && /Forbidden/.test(e.message)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('[API] POST /global-assets/:id/use failed:', e);
    return NextResponse.json({ error: 'Failed to record asset usage' }, { status: 500 });
  }
}
