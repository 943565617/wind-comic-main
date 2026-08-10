/**
 * GET/POST /api/projects/[id]/review-status · v3.x P0.3 E.3
 *
 * GET → ProjectReviewStatus (含 default 'draft' if no record)
 * POST body: { action: 'submit'|'approve'|'request_changes'|'withdraw', note?: string }
 *   submit → in_review
 *   approve → approved
 *   request_changes → changes_requested (note 必填)
 *   withdraw → draft (撤回, 仅 in_review 状态可)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getReviewStatus, transitionReviewStatus, type ReviewStatus } from '@/lib/review-status';
import { requireProjectAccess } from '@/lib/auth-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTION_TO_STATUS: Record<string, ReviewStatus> = {
  submit: 'in_review',
  approve: 'approved',
  request_changes: 'changes_requested',
  withdraw: 'draft',
};

export async function GET(request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  // v12.230(鉴权复扫收口):本 GET 此前无鉴权 —— 知道 projectId 即可读取他人项目数据。
  const _g = await requireProjectAccess(request, projectId, 'view');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

  const status = getReviewStatus(projectId);
  return NextResponse.json(status);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  // v12.234(二轮对抗复检 · HIGH):此处原是 `const actorId = resolveUserId(request); if (!actorId) 401`——
  // 但 resolveUserId 的**返回类型虽写 string|null,函数体却永不返回 null**(匿名回落 '__no_auth__' 字符串)。
  // '__no_auth__' 是 truthy,所以那个 401 是**永不触发的死检查**,看着有守卫其实等于没有。
  // 更糟的是 transitionReviewStatus 不校验项目归属 → 任何人可 approve/withdraw **任意项目**的审核状态。
  // 同文件 GET 有只读级守卫,POST 却裸奔,读写鉴权完全不对称。
  const _g = await requireProjectAccess(request, projectId, 'edit');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });
  const actorId = _g.userId;

  let body: any = {};
  try { body = await request.json(); } catch { /* allow */ }
  const action = String(body?.action || '');
  const toStatus = ACTION_TO_STATUS[action];
  if (!toStatus) {
    return NextResponse.json({ error: `非法 action: ${action}` }, { status: 400 });
  }
  const note = typeof body?.note === 'string' ? body.note : undefined;

  const result = transitionReviewStatus({
    projectId, toStatus, actorUserId: actorId, note,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result.status);
}
