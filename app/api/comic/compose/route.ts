/**
 * POST /api/comic/compose — 漫转视频出片:真片段按分格顺序拼成动态漫剧(v12.256)。
 *
 * body: { videoClips: string[](按分格阅读顺序), musicUrl? }
 * → 每段 persistAsset 落地(继承 SSRF/验签/64MB 限流)→ concatVideosSimple 顺序拼接 + 可选配乐
 *   → 返回成片签名 serve-file URL。
 *
 * 与 MV 的 /api/mv/compose 对称:MV 按卡点裁切硬切,漫剧按**分格阅读顺序整段拼**(每格动效片段完整播放)。
 * 生成每格动效是「单图变视频」的事(漫转分格台已能一键 → 动效),本端点只做顺序拼接 —— 纯本地 ffmpeg,无付费外呼。
 */
import { NextResponse, type NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth-guard';
import { persistAsset } from '@/lib/asset-storage';
import { serveFilePathUrl } from '@/lib/serve-file-sign';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** 一次最多拼接的片段数(= 分格数上限;防超大 body / 超长拼接)。 */
const MAX_CLIPS = 30;
const SAFE_VIDEO_URL = /^(https?:|\/api\/serve-file)/;

/** 每用户单并发:挡「开 N tab 狂点」把 CPU/临时盘打爆(与 mv/compose 同哲学)。 */
const inFlight = new Set<string>();

export async function POST(request: NextRequest) {
  const g = requireUser(request);
  if (!g.ok) return NextResponse.json({ message: g.message }, { status: g.status });

  let body: any = {};
  try { body = await request.json(); } catch { /* empty */ }

  const rawClips = Array.isArray(body?.videoClips) ? body.videoClips : [];
  const videoClips = rawClips
    .filter((u: unknown): u is string => typeof u === 'string' && SAFE_VIDEO_URL.test(u.trim()))
    .map((u: string) => u.trim())
    .slice(0, MAX_CLIPS);
  if (rawClips.length > 0 && videoClips.length === 0) {
    return NextResponse.json({ message: 'videoClips 需为 http(s) 或站内 serve-file —— 你传的都不合法' }, { status: 400 });
  }
  if (videoClips.length === 0) {
    return NextResponse.json({ message: '需要 videoClips(至少一段真片段,按分格顺序)' }, { status: 400 });
  }
  if (videoClips.length < 2) {
    return NextResponse.json({ message: '至少两段片段才能拼成动态漫剧' }, { status: 400 });
  }

  // 每用户单并发。
  if (inFlight.has(g.userId)) {
    return NextResponse.json({ message: '你已有一个漫剧正在合成,请等它完成再试' }, { status: 429 });
  }
  inFlight.add(g.userId);

  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const scratchDir = path.join(os.tmpdir(), `comic-compose-${g.userId.slice(0, 8)}-${Date.now()}`);

  try {
    const { concatVideosSimple } = await import('@/services/video-composer');

    // 每段落地(SSRF/验签/64MB 继承)→ 本地路径,按传入顺序拼(= 分格阅读顺序)。
    const localClips: string[] = [];
    for (const url of videoClips) {
      const persisted = await persistAsset(url);
      if (!persisted?.absPath) {
        return NextResponse.json({ message: `片段无法获取或被安全策略拒绝:${url.slice(0, 60)}` }, { status: 400 });
      }
      localClips.push(persisted.absPath);
    }

    // 可选配乐:签名 serve-file URL(concatVideosSimple 的 BGM 分支只认 http/serve-file)。
    // 用户给了配乐但格式不对 / 落地失败(如超 64MB 被限流)→ 记 musicDropped 如实回传,别假装有 BGM。
    let musicUrl: string | undefined;
    let musicDropped = false;
    const rawMusic = typeof body?.musicUrl === 'string' ? body.musicUrl.trim() : '';
    if (rawMusic) {
      const m = SAFE_VIDEO_URL.test(rawMusic) ? await persistAsset(rawMusic) : null;
      if (m?.absPath) musicUrl = serveFilePathUrl(m.absPath);
      else musicDropped = true;
    }

    // 顺序拼接(concat -c copy:片段最好同编码/分辨率,通常来自同一 u2v provider;不同源可能拼接报错)。
    const outputPath = await concatVideosSimple(localClips, musicUrl, scratchDir);
    return NextResponse.json({
      ok: true,
      finalVideoUrl: serveFilePathUrl(outputPath),
      clipCount: localClips.length,
      musicDropped,
    });
  } catch (e) {
    return NextResponse.json({ message: `动态漫剧合成失败:${e instanceof Error ? e.message : 'unknown'}(片段需同编码/分辨率才能顺序拼接)` }, { status: 500 });
  } finally {
    // 清下载/拼接的临时目录(成片写在 data/composed,不在此,不会误删);解除在途标记。
    try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch { /* noop */ }
    inFlight.delete(g.userId);
  }
}
