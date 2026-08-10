/**
 * POST /api/story-intake/analyze (v12.194) — AI 问书:长文本 → 结构化档案。
 * body: { text } → StoryProfile(人物关系/世界观设定/高光情节;超长三段采样并如实标注)。
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../auth/lib';
import { sampleLongText, buildAnalyzePrompt, type StoryProfile } from '@/lib/story-analyze';
import { robustJsonParse } from '@/lib/polish-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({} as any));
  const text = typeof body?.text === 'string' ? body.text : '';
  if (text.trim().length < 500) return NextResponse.json({ message: '文本太短(<500 字),直接用创作工坊即可' }, { status: 400 });
  if (text.length > 2_000_000) return NextResponse.json({ message: '超过 200 万字符上限' }, { status: 413 });

  const { sample, sampledOnly } = sampleLongText(text);
  const { callLLMWithFallback } = await import('@/lib/llm-client');
  const res = await callLLMWithFallback({
    system: buildAnalyzePrompt(),
    user: sample,
    jsonMode: true, maxTokens: 8192, timeoutMs: 240_000,
  });
  if (!res.ok || !res.content) return NextResponse.json({ message: `分析失败:${res.error || 'unknown'}` }, { status: 502 });
  const profile = robustJsonParse(res.content) as StoryProfile | null;
  if (!profile || !Array.isArray(profile.characters)) {
    return NextResponse.json({ message: '档案解析失败,请重试' }, { status: 502 });
  }
  profile.sampledOnly = sampledOnly;
  return NextResponse.json({ ok: true, profile, sampledOnly });
}
