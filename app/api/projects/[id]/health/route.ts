/**
 * GET /api/projects/[id]/health (v12.153;v12.155 取数抽公共 film-health-io) — 成片全维体检。
 */
import { NextRequest, NextResponse } from 'next/server';
import { buildProjectHealth } from '@/lib/film-health-io';
import { requireProjectAccess } from '@/lib/auth-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // v12.230(鉴权复扫收口):v12.218「鉴权总修」只修了对抗报告点名的端点,
  // 未系统复扫 projects/[id]/** —— 本路由当时漏网,任何人知道 projectId 即可调用。
  const _g = await requireProjectAccess(request, id, 'view');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

  const report = await buildProjectHealth(id);
  return NextResponse.json({ ...report, probedAt: new Date().toISOString() });
}
