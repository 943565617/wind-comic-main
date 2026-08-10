/**
 * /api/global-assets  (v2.0 Sprint 0 D4)
 *
 * 全局资产记忆库 —— 跨项目复用的角色/场景/风格/道具。
 *
 * GET  /api/global-assets?type=character&q=keyword&limit=50&offset=0
 * POST /api/global-assets  body={ type, name, description?, tags?, thumbnail?, visualAnchors?, metadata? }
 *
 * Auth: 优先读 JWT sub；无 token 时回退到 DB 第一个用户（Demo 模式）
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth-guard';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../auth/lib';
import {
  createGlobalAsset,
  listGlobalAssets,
  type CreateGlobalAssetInput,
} from '@/lib/repos/global-asset-repo'; // v9.0.3b: async, 双驱动
import type { GlobalAssetType } from '@/types/agents';

export const runtime = 'nodejs';

const VALID_TYPES: GlobalAssetType[] = ['character', 'scene', 'style', 'prop', 'template'];

function resolveUserId(request: Request): string {
  const payload = getUserFromRequest(request);
  if (payload?.sub) return payload.sub;
  // v12.218(安全止血):不再回落 DB 首用户,匿名用 sentinel(查空不泄露)
  return '__no_auth__';
}

export async function GET(request: NextRequest) {
  try {
    const userId = resolveUserId(request);
    const typeParam = request.nextUrl.searchParams.get('type') || undefined;
    const q = request.nextUrl.searchParams.get('q') || undefined;
    const limit = Number(request.nextUrl.searchParams.get('limit') || 50);
    const offset = Number(request.nextUrl.searchParams.get('offset') || 0);

    if (typeParam && !VALID_TYPES.includes(typeParam as GlobalAssetType)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` },
        { status: 400 },
      );
    }

    const assets = await listGlobalAssets({
      userId,
      type: typeParam as GlobalAssetType | undefined,
      q,
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
    });

    return NextResponse.json({ assets, total: assets.length });
  } catch (e) {
    console.error('[API] GET /global-assets failed:', e);
    return NextResponse.json({ error: 'Failed to list global assets' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  // v12.236(第三轮对抗复检):与 v12.234 已修的 templates/shared clone **完全同款** ——
  // 匿名请求拿到 '__no_auth__' 后继续执行 createGlobalAsset,往全局资产库写垃圾记录;
  // 且 GET/PATCH/DELETE 的 `asset.userId !== userId` 守门对哨兵无效(同一哨兵值互相可见),
  // 于是匿名写入的资产又能被任意匿名请求读改删。上一版按清单逐个修,这个文件不在清单里就漏了 ——
  // 所以本版把不变量测试从「哨兵+写操作」扩到**所有 handler**,而不是继续靠清单。
  const _g = await requireUser(request);
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });
  try {
    const userId = _g.userId;
    const body = (await request.json().catch(() => ({}))) as Partial<CreateGlobalAssetInput>;

    if (!body.type || !VALID_TYPES.includes(body.type as GlobalAssetType)) {
      return NextResponse.json(
        { error: `type is required and must be one of: ${VALID_TYPES.join(', ')}` },
        { status: 400 },
      );
    }
    if (!body.name || String(body.name).trim().length === 0) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const asset = await createGlobalAsset({
      userId,
      type: body.type as GlobalAssetType,
      name: String(body.name).trim(),
      description: body.description,
      tags: body.tags,
      thumbnail: body.thumbnail,
      visualAnchors: body.visualAnchors,
      metadata: body.metadata,
    });

    return NextResponse.json(asset, { status: 201 });
  } catch (e) {
    console.error('[API] POST /global-assets failed:', e);
    return NextResponse.json({ error: 'Failed to create global asset' }, { status: 500 });
  }
}
