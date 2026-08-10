/**
 * GET /api/series/[id]/drama-package (v12.188) — TikTok Drama Center 出海打包。
 * completed 集成片 + 系列封面 + 定价建议 + 上传指引,一次取齐(平台入驻制无直发 API)。
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../auth/lib';
import { listSeriesEpisodesFull } from '@/lib/repos/series-repo';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { buildDramaPackage } from '@/lib/drama-package';
import { probeMediaFull } from '@/lib/film-health';
import { serveFileToLocalPath } from '@/lib/first-frame';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function firstUrl(raw: string | null | undefined): string {
  try { const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) && a[0] ? a[0] : ''; } catch { return ''; }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  // v12.222 合规:导出前必须显式确认 AI 声明(前端勾选框 → aiAck=1)。
  // 未确认 → 422,不给「忘标 AI」的机会;全片皆 AIGC,声明是硬门槛而非可选提示。
  const aiAck = new URL(request.url).searchParams.get('aiAck');
  if (aiAck !== '1' && aiAck !== 'true') {
    return NextResponse.json({ error: 'AI 声明未确认:出海打包需先勾选「本片由 AI 生成」声明(aiAck=1)', code: 'ai_declaration_required' }, { status: 422 });
  }
  const eps = await listSeriesEpisodesFull(id, payload.sub);
  if (eps.length === 0) return NextResponse.json({ error: '系列无剧集(或非本人)' }, { status: 404 });

  const done = eps.filter((e) => e.status === 'completed');
  const episodes = [] as Array<{ episodeNumber: number; title: string; videoUrl: string; durationSec?: number }>;
  for (const ep of done) {
    const finals = await listAssetsByType(ep.id, 'final_video');
    const row = finals[0];
    const url = row ? (row.persistent_url || firstUrl(row.media_urls)) : '';
    if (!url) continue;
    const probe = await probeMediaFull(serveFileToLocalPath(url) || url).catch(() => null);
    episodes.push({ episodeNumber: ep.episode_number ?? 0, title: ep.title, videoUrl: url, durationSec: probe?.durationSec });
  }
  if (episodes.length === 0) return NextResponse.json({ error: '没有已完成且有成片的集' }, { status: 422 });

  // 系列封面(锚点集 season_cover)
  let coverUrl: string | null = null;
  const anchor = eps.find((e) => (e.episode_number ?? 99) === Math.min(...eps.map((x) => x.episode_number ?? 99)));
  if (anchor) {
    const covers = await listAssetsByType(anchor.id, 'season_cover');
    coverUrl = covers[0] ? (covers[0].persistent_url || firstUrl(covers[0].media_urls)) || null : null;
  }

  const lang = new URL(request.url).searchParams.get('language') || 'zh';
  return NextResponse.json(buildDramaPackage({ seriesTitle: anchor?.title?.replace(/第.*集.*$/, '').trim() || '未命名系列', language: lang, coverUrl, episodes }));
}
