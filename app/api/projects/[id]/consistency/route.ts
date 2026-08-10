/**
 * /api/projects/[id]/consistency · v9.4.5
 *
 * GET 项目级一致性报告 —— 聚合跨迭代轮次的成片 3 维评分(连贯/光影/脸,project_quality_scores)
 * → 最新各维 + 跨轮趋势 + 最弱维 + 时间序列(`lib/consistency-report`)。只读,供「一致性」视图。
 */
import { listQualityScores } from '@/lib/quality-scores';
import { buildConsistencyReport } from '@/lib/consistency-report';
import { NextResponse } from 'next/server';
import { requireProjectAccess } from '@/lib/auth-guard';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // v12.230(鉴权复扫收口):v12.218「鉴权总修」只修了对抗报告点名的端点,
  // 未系统复扫 projects/[id]/** —— 本路由当时漏网,任何人知道 projectId 即可调用。
  const _g = await requireProjectAccess(request, id, 'view');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

  const scores = await listQualityScores(id); // newest-first
  const report = buildConsistencyReport(scores);
  return NextResponse.json({ projectId: id, report });
}
