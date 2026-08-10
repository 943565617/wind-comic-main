/**
 * /api/projects/[id]/lipsync-align · v9.7.14
 *
 * 存/读 实测的「口型-音频对齐分」(shotNumber → 0-100,来自面板 Web Audio 测量 / 批量 QC)。
 * 存 `project_assets type='lipsync-align'`(一项目一条,合并式)。publish-readiness 据此并入发布门禁。
 */
import { listAssetsByType, deleteAssetsByType, createAsset } from '@/lib/repos/asset-repo';
import { NextResponse } from 'next/server';
import { requireProjectAccess } from '@/lib/auth-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readScores(id: string): Promise<Record<string, number>> {
  const rows = await listAssetsByType(id, 'lipsync-align');
  try { return JSON.parse(rows[0]?.data || '{}')?.scores || {}; } catch { return {}; }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // v12.230(鉴权复扫收口):v12.218「鉴权总修」只修了对抗报告点名的端点,
  // 未系统复扫 projects/[id]/** —— 本路由当时漏网,任何人知道 projectId 即可调用。
  const _g = await requireProjectAccess(request, id, 'view');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

  return NextResponse.json({ scores: await readScores(id) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // v12.230(鉴权复扫收口):v12.218「鉴权总修」只修了对抗报告点名的端点,
  // 未系统复扫 projects/[id]/** —— 本路由当时漏网,任何人知道 projectId 即可调用。
  const _g = await requireProjectAccess(request, id, 'edit');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

  const body = (await request.json().catch(() => ({}))) as { scores?: Record<string, unknown> };
  const incoming = body?.scores && typeof body.scores === 'object' ? body.scores : {};
  const merged: Record<string, number> = { ...(await readScores(id)) };
  for (const [k, v] of Object.entries(incoming)) {
    const n = Number(v);
    if (String(k).trim() && Number.isFinite(n)) merged[String(k)] = Math.round(Math.max(0, Math.min(100, n)));
  }
  await deleteAssetsByType(id, 'lipsync-align');
  await createAsset({ projectId: id, type: 'lipsync-align', name: '口型-音频对齐分', data: { scores: merged }, version: 1 });
  return NextResponse.json({ ok: true, scores: merged });
}
