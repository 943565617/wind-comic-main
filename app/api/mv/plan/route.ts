/**
 * POST /api/mv/plan — MV(音乐视频)镜头规划(v12.246)。
 *
 * MV 模式的后端骨架:给音乐时长 + BPM(+ 可选段落),返回**卡点镜头时间轴**
 * (每镜起止秒落在拍上、副歌加密、末镜贴合音乐结尾)。
 *
 * 纯计算、无外部付费调用 —— 只需登录守卫(防未登录滥用),不需要预算守卫。
 * 出片链路(每镜配画面 → 卡点合成)复用既有 generateImage / u2v / video-composer,不在本端点。
 */
import { NextResponse, type NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth-guard';
import { planMvShots, summarizeMvPlan, type MvSection, type MvSectionKind } from '@/lib/mv-plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_SECTIONS: MvSectionKind[] = ['intro', 'verse', 'chorus', 'bridge', 'outro'];

function parseSections(raw: unknown): MvSection[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: MvSection[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const kind = (s as { kind?: unknown }).kind;
    const startSec = Number((s as { startSec?: unknown }).startSec);
    const endSec = Number((s as { endSec?: unknown }).endSec);
    if (!VALID_SECTIONS.includes(kind as MvSectionKind)) continue;
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) continue;
    out.push({ kind: kind as MvSectionKind, startSec, endSec });
  }
  return out.length ? out : undefined;
}

export async function POST(request: NextRequest) {
  const g = requireUser(request);
  if (!g.ok) return NextResponse.json({ message: g.message }, { status: g.status });

  let body: any = {};
  try { body = await request.json(); } catch { /* empty */ }

  const musicDurationSec = Number(body?.musicDurationSec);
  const bpm = Number(body?.bpm);
  if (!Number.isFinite(musicDurationSec) || musicDurationSec <= 0) {
    return NextResponse.json({ message: 'musicDurationSec 需为正数(音乐时长,秒)' }, { status: 400 });
  }
  if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 400) {
    return NextResponse.json({ message: 'bpm 需在 1~400 之间' }, { status: 400 });
  }
  // 时长上限:MV 一般 ≤ 6 分钟,防止有人传超大值算出上万镜
  if (musicDurationSec > 600) {
    return NextResponse.json({ message: '音乐时长上限 600s(MV 场景足够)' }, { status: 400 });
  }

  const shots = planMvShots({
    musicDurationSec,
    bpm,
    beatsPerShot: Number.isFinite(Number(body?.beatsPerShot)) ? Number(body.beatsPerShot) : undefined,
    phaseSec: Number.isFinite(Number(body?.phaseSec)) ? Number(body.phaseSec) : undefined,
    minShotSec: Number.isFinite(Number(body?.minShotSec)) ? Number(body.minShotSec) : undefined,
    sections: parseSections(body?.sections),
  });

  return NextResponse.json({
    ok: true,
    shots,
    summary: summarizeMvPlan(shots),
    shotCount: shots.length,
  });
}
