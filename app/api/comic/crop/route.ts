/**
 * POST /api/comic/crop — 漫转视频:分格后把每格裁成图(v12.252)。
 *
 * body: { imageUrl: http(s) / data: / 站内 serve-file }
 * → 落地(persistAsset,SSRF/验签/白名单全继承)→ 投影法分格 → sharp 逐格裁图 → 返回每格签名 URL。
 *
 * 纯像素计算 + 本地裁图,无付费外呼 —— 只需登录守卫。每格图 → 单图变视频(u2v)加动效 → 卡点拼接
 * 是漫转出片的下一步,复用既有链路,不在本端点。
 */
import { NextResponse, type NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth-guard';
import { persistAsset } from '@/lib/asset-storage';
import { detectComicPanels } from '@/lib/comic-panels-extract';
import { cropPanels } from '@/lib/comic-crop';
import { serveFilePathUrl } from '@/lib/serve-file-sign';
import { LOCAL_STORAGE_ROOT } from '@/lib/storage';
import { summarizePanels } from '@/lib/comic-panels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** 单次裁图上限:正常漫画就几格~十几格,封顶防病态图算出成百上千格拖垮服务。 */
const MAX_PANELS = 30;

export async function POST(request: NextRequest) {
  const g = requireUser(request);
  if (!g.ok) return NextResponse.json({ message: g.message }, { status: g.status });

  let body: any = {};
  try { body = await request.json(); } catch { /* empty */ }

  const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : '';
  if (!imageUrl || !/^(https?:|data:|\/api\/serve-file)/.test(imageUrl)) {
    return NextResponse.json({ message: '需要 imageUrl(http(s) / data: / 站内 serve-file)' }, { status: 400 });
  }

  // 落地:persistAsset 走 safeFetch(外链 SSRF)/ resolveVerifiedServeFilePath(站内验签),防护全继承。
  let absPath: string;
  let stem: string;
  try {
    const persisted = await persistAsset(imageUrl);
    if (!persisted?.absPath) {
      return NextResponse.json({ message: '图片无法获取或被安全策略拒绝' }, { status: 400 });
    }
    absPath = persisted.absPath;
    stem = persisted.key; // 内容 hash 作前缀:同图重复裁切文件名稳定,不堆垃圾
  } catch (e) {
    return NextResponse.json({ message: `图片获取失败:${e instanceof Error ? e.message : 'unknown'}` }, { status: 400 });
  }

  try {
    const panels = await detectComicPanels(absPath, {
      contentThreshold: numOr(body?.contentThreshold),
      minGutterRatio: numOr(body?.minGutterRatio),
      minBandRatio: numOr(body?.minBandRatio),
    });
    if (panels.length === 0) {
      return NextResponse.json({
        ok: true, panels: [], count: 0,
        summary: summarizePanels([]),
        hint: '未检出格子 —— 不规则跨栏布局投影法切不准(需 CV,暂不支持);条漫/规则网格通常没问题。',
      });
    }
    const capped = panels.slice(0, MAX_PANELS);
    const cropped = await cropPanels(absPath, capped, LOCAL_STORAGE_ROOT, stem);
    return NextResponse.json({
      ok: true,
      count: cropped.length,
      truncated: panels.length > MAX_PANELS ? panels.length : undefined,
      summary: summarizePanels(capped),
      panels: cropped.map((c) => ({
        x: c.x, y: c.y, w: c.w, h: c.h, row: c.row, col: c.col,
        url: serveFilePathUrl(c.absPath),
      })),
    });
  } catch (e) {
    return NextResponse.json({ message: `裁图失败:${e instanceof Error ? e.message : 'unknown'}` }, { status: 500 });
  }
}

function numOr(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
