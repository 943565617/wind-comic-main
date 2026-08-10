/**
 * GET /api/series/[id]/health (v12.155) — 系列质量中枢:逐集体检聚合。
 * 复用 buildProjectHealth(与单项目 /health 同判定),有界并发 2(逐集 ffprobe)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { listSeriesEpisodesFull } from '@/lib/repos/series-repo';
import { buildProjectHealth, mapPool } from '@/lib/film-health-io';
import { getUserFromRequest } from '../../../auth/lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const episodes = await listSeriesEpisodesFull(id, payload.sub);
  if (episodes.length === 0) return NextResponse.json({ episodes: [] });

  const results = await mapPool(episodes, 2, async (ep) => {
    try {
      const h = await buildProjectHealth(ep.id);
      return {
        projectId: ep.id,
        episodeNumber: ep.episode_number,
        title: (ep as any).title || `第 ${ep.episode_number} 集`,
        overall: h.overall,
        animaticShots: h.animaticShots,
        failItems: h.items.filter((i) => i.status === 'fail').map((i) => i.label),
        warnItems: h.items.filter((i) => i.status === 'warn').map((i) => i.label),
      };
    } catch {
      return { projectId: ep.id, episodeNumber: ep.episode_number, title: `第 ${ep.episode_number} 集`, overall: 'unknown' as const, animaticShots: [], failItems: [], warnItems: [] };
    }
  });

  const degradedEpisodes = results.filter((r) => r.animaticShots.length > 0).length;
  return NextResponse.json({ episodes: results, degradedEpisodes, probedAt: new Date().toISOString() });
}
