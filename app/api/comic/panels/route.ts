/**
 * POST /api/comic/panels — 漫转视频模式:漫画自动分格(v12.247)。
 *
 * body: { imageUrl: http(s) / data: / 站内 serve-file }
 * → 落地(persistAsset,SSRF/验签/白名单全继承)→ sharp 提密度 → 投影法切格 → 返回格子边界框。
 *
 * 分格是纯像素计算,无付费外呼 —— 只需登录守卫。每格裁图 → u2v 加动效 → 拼接是漫转的下一步,
 * 复用既有 generateVideo / video-composer,不在本端点。
 */
import { NextResponse, type NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth-guard';
import { persistAsset } from '@/lib/asset-storage';
import { detectComicPanels } from '@/lib/comic-panels-extract';
import { summarizePanels } from '@/lib/comic-panels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const g = requireUser(request);
  if (!g.ok) return NextResponse.json({ message: g.message }, { status: g.status });

  let body: any = {};
  try { body = await request.json(); } catch { /* empty */ }

  const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : '';
  if (!imageUrl || !/^(https?:|data:|\/api\/serve-file)/.test(imageUrl)) {
    return NextResponse.json({ message: '需要 imageUrl(http(s) / data: / 站内 serve-file)' }, { status: 400 });
  }

  // 落地:persistAsset 内部走 safeFetch(外链 SSRF)/ resolveVerifiedServeFilePath(站内验签),
  // 本端点因此自动继承那套出站/读盘防护,不重造。
  let absPath: string;
  try {
    const persisted = await persistAsset(imageUrl);
    if (!persisted?.absPath) {
      return NextResponse.json({ message: '图片无法获取或被安全策略拒绝' }, { status: 400 });
    }
    absPath = persisted.absPath;
  } catch (e) {
    return NextResponse.json({ message: `图片获取失败:${e instanceof Error ? e.message : 'unknown'}` }, { status: 400 });
  }

  let panels;
  try {
    panels = await detectComicPanels(absPath, {
      contentThreshold: numOr(body?.contentThreshold),
      minGutterRatio: numOr(body?.minGutterRatio),
      minBandRatio: numOr(body?.minBandRatio),
    });
  } catch (e) {
    return NextResponse.json({ message: `分格失败:${e instanceof Error ? e.message : 'unknown'}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    panels,
    panelCount: panels.length,
    summary: summarizePanels(panels),
    hint: panels.length <= 1
      ? '只检出 1 格或 0 格 —— 若原图是不规则跨栏布局,投影法可能切不准(需 CV 版面分析,暂不支持);条漫/规则网格通常没问题。'
      : undefined,
  });
}

function numOr(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
