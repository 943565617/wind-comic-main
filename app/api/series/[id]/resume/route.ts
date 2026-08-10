/**
 * POST /api/series/[id]/resume (v12.182) — 百集并行断点续跑。
 *
 * 病根:inline 模式(默认)池状态驻内存,服务重启后在途集永卡 active;
 * queue 模式有 recoverOrphanJobs 但只救 job,不救「无 job 的 active 集」。
 * 判定卡死:status=active 且 projects.updated_at 距今 > staleMinutes(默认 30)→ 重置 draft,
 * 调用方随后再点「批量生成」即从断点续跑(completed 集天然跳过)。
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../auth/lib';
import { listSeriesEpisodesFull, setEpisodeStatus } from '@/lib/repos/series-repo';
import { getDbDriver } from '@/lib/db-driver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any = {}; try { body = await request.json(); } catch { /* ignore */ }
  const staleMinutes = Number(body?.staleMinutes) > 0 ? Number(body.staleMinutes) : 30;
  const cutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString();

  const eps = await listSeriesEpisodesFull(id, payload.sub);
  if (eps.length === 0) return NextResponse.json({ error: '系列无剧集(或非本人)' }, { status: 404 });

  const reset: number[] = [];
  for (const ep of eps) {
    if (ep.status !== 'active') continue;
    const row = (await getDbDriver().get('SELECT updated_at FROM projects WHERE id = ?', [ep.id])) as { updated_at?: string } | undefined;
    if (!row?.updated_at || row.updated_at < cutoff) {
      await setEpisodeStatus(ep.id, 'draft');
      reset.push(ep.episode_number ?? -1);
    }
  }
  return NextResponse.json({
    ok: true, reset, staleMinutes,
    message: reset.length
      ? `已把 ${reset.length} 个卡死的集(第 ${reset.join('、')} 集)重置为待生成 —— 点「批量生成」即断点续跑`
      : '没有卡死的集(active 集仍在活跃更新)',
  });
}
