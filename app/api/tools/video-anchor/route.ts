/**
 * POST /api/tools/video-anchor (v12.183) — 角色参考视频抽帧。
 * body: { videoUrl, frames? } → { frames: string[] }(serve-file URLs;失败空数组)。
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../auth/lib';
import { extractAnchorFrames } from '@/lib/video-anchor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({} as any));
  const videoUrl = typeof body?.videoUrl === 'string' ? body.videoUrl.trim() : '';
  if (!videoUrl || !/^(https?:|\/api\/serve-file)/.test(videoUrl)) {
    return NextResponse.json({ message: '缺 videoUrl(http(s) / 站内 serve-file)' }, { status: 400 });
  }
  const n = Math.min(6, Math.max(1, Number(body?.frames) || 3));
  const frames = await extractAnchorFrames(videoUrl, n);
  return NextResponse.json({ frames, count: frames.length });
}
