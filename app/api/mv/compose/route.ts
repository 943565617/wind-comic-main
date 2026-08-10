/**
 * POST /api/mv/compose — MV 出片:卡点时间轴 → 卡点成片(v12.253 静帧 / v12.254 真片段)。
 *
 * 两种画面来源,二选一:
 *   · videoClips: string[]  —— **真视频片段**(用户自带 / 单图变视频出的成片 URL)。每段按卡点时长
 *     被 composeVideo「设计时长裁切」硬切,拼成按拍剪辑的真片段 MV。← v12.254
 *   · imageUrls:  string[]  —— 静帧:每图 stillFrameToVideo 出 ken-burns 动画再硬切。← v12.253
 * 另可选 musicUrl / aspect。
 *
 * 纯本地 ffmpeg,无付费生成外呼(生成真片段是「单图变视频」的事,本端点只做卡点拼接)—— 只需登录守卫。
 * 为控时长/内存,镜头数封顶(超了让用户调大每镜拍数)。
 */
import { NextResponse, type NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth-guard';
import { persistAsset } from '@/lib/asset-storage';
import { planMvShots } from '@/lib/mv-plan';
import { assignMvClips, assignMvVideoClips } from '@/lib/mv-compose-plan';
import { serveFilePathUrl } from '@/lib/serve-file-sign';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** 出片镜头上限:每镜一次 ffmpeg,太多会超时/吃内存。超了让用户调大每镜拍数。 */
const MAX_MV_SHOTS = 24;
/** 一次最多接受的画面/片段数(防超大 body)。 */
const MAX_SOURCES = 40;
/**
 * 图片单边像素上限。字节 <64MB 不代表安全:一张 80B 的 SVG 声明 100000×100000,或高压缩的超大 PNG,
 * 都能让 ffmpeg/librsvg 光栅化时吃几十 GB 内存 OOM。落地后用 sharp 读**声明尺寸**(不光栅化,便宜)卡上限。
 */
const MAX_IMAGE_DIM = 8000;
const SAFE_IMAGE_URL = /^(https?:|data:image\/|\/api\/serve-file)/;
/** 真片段只收 http(s)/站内 serve-file(视频不走 data: —— 太大)。 */
const SAFE_VIDEO_URL = /^(https?:|\/api\/serve-file)/;

/**
 * 每用户在途合成数(内存级):一个用户同时只能有一个 MV 合成在跑。挡「开 10 个 tab 狂点」把 CPU/临时盘打爆。
 * 非分布式限流(多实例下每实例各算),但足以拦最常见的单用户并发滥用;正式限流靠基建层。
 */
const inFlight = new Set<string>();

export async function POST(request: NextRequest) {
  const g = requireUser(request);
  if (!g.ok) return NextResponse.json({ message: g.message }, { status: g.status });

  let body: any = {};
  try { body = await request.json(); } catch { /* empty */ }

  const musicDurationSec = Number(body?.musicDurationSec);
  const bpm = Number(body?.bpm);
  if (!Number.isFinite(musicDurationSec) || musicDurationSec <= 0 || musicDurationSec > 600) {
    return NextResponse.json({ message: 'musicDurationSec 需为正数且 ≤ 600' }, { status: 400 });
  }
  if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 400) {
    return NextResponse.json({ message: 'bpm 需在 1~400 之间' }, { status: 400 });
  }

  // 画面来源:优先真片段(videoClips),否则静帧(imageUrls)。二者都空 → 400。
  const rawVideoClips = Array.isArray(body?.videoClips) ? body.videoClips : [];
  const videoClips = rawVideoClips
    .filter((u: unknown): u is string => typeof u === 'string' && SAFE_VIDEO_URL.test(u.trim()))
    .map((u: string) => u.trim())
    .slice(0, MAX_SOURCES);
  // 传了 videoClips 却被安全过滤全清空 → 明确报错,绝不静默回退到静帧(否则调用方以为出了真片段 MV)。
  if (rawVideoClips.length > 0 && videoClips.length === 0) {
    return NextResponse.json({ message: 'videoClips 需为 http(s) 或站内 serve-file —— 你传的都不合法' }, { status: 400 });
  }
  const imageUrls = (Array.isArray(body?.imageUrls) ? body.imageUrls : [])
    .filter((u: unknown): u is string => typeof u === 'string' && SAFE_IMAGE_URL.test(u.trim()))
    .map((u: string) => u.trim())
    .slice(0, MAX_SOURCES);

  const mode: 'video' | 'still' = videoClips.length > 0 ? 'video' : 'still';
  if (mode === 'still' && imageUrls.length === 0) {
    return NextResponse.json({ message: '需要 videoClips(真片段,http(s)/站内)或 imageUrls(画面)' }, { status: 400 });
  }

  const aspect = ['16:9', '9:16', '1:1'].includes(body?.aspect) ? body.aspect : '9:16';

  const shots = planMvShots({
    musicDurationSec,
    bpm,
    beatsPerShot: Number.isFinite(Number(body?.beatsPerShot)) ? Number(body.beatsPerShot) : undefined,
  });
  if (shots.length === 0) {
    return NextResponse.json({ message: '按此参数算不出卡点镜头,请调整时长/BPM' }, { status: 400 });
  }
  if (shots.length > MAX_MV_SHOTS) {
    return NextResponse.json({
      message: `卡点镜头 ${shots.length} 个超过出片上限 ${MAX_MV_SHOTS} —— 调大「每镜拍数」或缩短音乐再试`,
    }, { status: 400 });
  }

  // 每用户单并发:已有在途合成 → 429,别让一个用户 N 个请求把机器打爆。
  if (inFlight.has(g.userId)) {
    return NextResponse.json({ message: '你已有一个 MV 正在合成,请等它完成再试' }, { status: 429 });
  }
  inFlight.add(g.userId);

  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  // 每请求唯一目录:防同用户并发合成共享目录、互相覆盖中间帧/片段(静帧模式用;真片段模式为空亦无妨)。
  const outputDir = path.join(os.tmpdir(), `mv-compose-${g.userId.slice(0, 8)}-${Date.now()}`);

  try {
    const { stillFrameToVideo, composeVideo } = await import('@/services/video-composer');
    const clips: Array<{ shotNumber: number; videoUrl: string; duration: number; transition: string }> = [];

    if (mode === 'video') {
      // 真片段:每段落地(继承 SSRF/验签/64MB 限流)→ 直接作为 clip;composeVideo 会按卡点时长裁切硬切。
      const specs = assignMvVideoClips(shots, videoClips);
      for (const spec of specs) {
        const persisted = await persistAsset(spec.videoUrl);
        if (!persisted?.absPath) {
          return NextResponse.json({ message: `片段无法获取或被安全策略拒绝:${spec.videoUrl.slice(0, 60)}` }, { status: 400 });
        }
        clips.push({ shotNumber: spec.shotNumber, videoUrl: persisted.absPath, duration: spec.durationSec, transition: 'cut' });
      }
    } else {
      // 静帧:每图落地 → 尺寸卡上限(sharp 读声明尺寸,不光栅化)→ stillFrameToVideo 出 ken-burns 动画。
      const sharp = (await import('sharp')).default;
      const specs = assignMvClips(shots, imageUrls);
      for (const spec of specs) {
        const persisted = await persistAsset(spec.imageUrl);
        if (!persisted?.absPath) {
          return NextResponse.json({ message: `图片无法获取或被安全策略拒绝:${spec.imageUrl.slice(0, 60)}` }, { status: 400 });
        }
        let dim: { width?: number; height?: number };
        try {
          dim = await sharp(persisted.absPath).metadata();
        } catch {
          return NextResponse.json({ message: `图片无法解析(可能不是有效图片):${spec.imageUrl.slice(0, 60)}` }, { status: 400 });
        }
        if (!dim.width || !dim.height || dim.width > MAX_IMAGE_DIM || dim.height > MAX_IMAGE_DIM) {
          return NextResponse.json({ message: `图片尺寸超上限(单边 ≤ ${MAX_IMAGE_DIM}px):${spec.imageUrl.slice(0, 60)}` }, { status: 400 });
        }
        const clipPath = await stillFrameToVideo(persisted.absPath, spec.durationSec, outputDir, spec.zoomDir);
        clips.push({ shotNumber: spec.shotNumber, videoUrl: clipPath, duration: spec.durationSec, transition: 'cut' });
      }
    }

    // 可选配乐:落地后传**签名 serve-file URL**。composeVideo 的配乐分支只认 http / /api/serve-file
    // (裸本地路径会被它静默丢弃),故这里必须 serveFilePathUrl 而非裸 absPath。
    // 给了配乐但格式不对 / 落地失败(如超 64MB)→ 记 musicDropped 如实回传,别假装有 BGM。
    let musicUrl: string | undefined;
    let musicDropped = false;
    const rawMusic = typeof body?.musicUrl === 'string' ? body.musicUrl.trim() : '';
    if (rawMusic) {
      const m = SAFE_VIDEO_URL.test(rawMusic) ? await persistAsset(rawMusic) : null;
      if (m?.absPath) musicUrl = serveFilePathUrl(m.absPath);
      else musicDropped = true;
    }

    // 卡点硬切拼接 + 配乐。成片在 composeVideo 自己的 tmp(qf-compose-*),不在本请求 outputDir,
    // 故 finally 清 outputDir 不会误删成片。
    const result = await composeVideo({ clips, aspect, musicUrl, musicVolume: 0.5 });
    const finalUrl = serveFilePathUrl(result.outputPath);
    return NextResponse.json({
      ok: true,
      mode,
      finalVideoUrl: finalUrl,
      shotCount: shots.length,
      duration: result.totalDuration,
      aspect,
      musicDropped,
    });
  } catch (e) {
    return NextResponse.json({ message: `MV 合成失败:${e instanceof Error ? e.message : 'unknown'}` }, { status: 500 });
  } finally {
    // 清中间静帧目录(成功/中途 400/异常都清),防临时盘无限堆积;解除在途标记。
    try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch { /* noop */ }
    inFlight.delete(g.userId);
  }
}
