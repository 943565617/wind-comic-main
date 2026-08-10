import { NextRequest, NextResponse } from 'next/server';
import { buildNarrationTrack } from '@/lib/narration-track';
import { synthesizeNarrationTrack } from '@/lib/narration-synth';
import { guardPaidEndpoint } from '@/lib/paid-endpoint-guard';

export const runtime = 'nodejs';

/**
 * v6.2.3 — 单集解说音轨真出 TTS.
 * POST { text, mode, voiceId? } → 构计划 → 走 TTS 引擎真出音频 (无引擎则降级返回计划).
 */
export async function POST(request: NextRequest) {
  // v12.232(对抗复检 CRITICAL 补漏):此前**零鉴权零预算** —— MiniMax TTS,按字符计费,
  // 匿名循环调用即可持续烧额度。登录 + 预算一并前置,拦下才花钱。
  const _pg = await guardPaidEndpoint(request, { pendingCostCny: 0.2 });
  if (!_pg.ok) return _pg.response;
  const body = await request.json().catch(() => ({} as any));
  const text = typeof body?.text === 'string' ? body.text : '';
  const mode = typeof body?.mode === 'string' ? body.mode : 'narrator';
  const voiceId = typeof body?.voiceId === 'string' ? body.voiceId : undefined;
  if (!text.trim()) return NextResponse.json({ message: 'text 必填' }, { status: 400 });

  const plan = buildNarrationTrack({ text, mode, voiceId });
  if (!plan.enabled) {
    return NextResponse.json({ enabled: false, rendered: false, track: plan });
  }

  const rendered = await synthesizeNarrationTrack(plan, { concurrency: 4 });
  return NextResponse.json({ enabled: true, rendered: rendered.rendered, track: rendered });
}
