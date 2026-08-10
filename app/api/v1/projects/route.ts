import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireApiKey } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 公开 REST API v1 — 项目列表
 *
 *   GET /api/v1/projects
 *     Header: Authorization: Bearer <API_KEY>
 *     Query:  ?limit=20&offset=0&status=active|completed
 *
 * 鉴权:`X-Api-Key` header 或 `Authorization: Bearer` 匹配环境变量 `API_KEYS` (逗号分隔)。
 *
 * ⚠️ v12.233(对抗复检收尾)—— **平台级 API,不做租户隔离,默认关闭**。
 *
 * 复检指出本端点「无 WHERE user_id 过滤,返回全平台项目」。核实后确认属实,但**加个过滤修不了** ——
 * `API_KEYS` 是**平台级共享凭据**(见 lib/api-auth.ts:10),一个 key 不绑定任何用户,
 * 所以「按 key 所属用户过滤」在当前设计下无从谈起。与其假装修好,不如把边界说清并默认关掉:
 *   · 未设 `API_KEYS` → requireApiKey 已全拒(默认安全);
 *   · 额外要求显式 `API_V1_ALLOW_CROSS_TENANT=1` 才放行 —— 逼运营者**主动确认**
 *     「我知道持 key 者能看到全平台项目」,而不是配了 key 就顺带敞开。
 * 真正的多租户方案是 per-key 绑定 user(lib/api-auth.ts:12 已记为「未来升级:DB 表 api_keys
 * 存 hash + scope」),那是独立特性,不在本轮加固范畴。
 */
export async function GET(req: NextRequest) {
  const authErr = requireApiKey(req);
  if (authErr) return authErr;

  // 平台级跨租户读取必须显式开启(见上方说明)
  if (process.env.API_V1_ALLOW_CROSS_TENANT !== '1') {
    return NextResponse.json({
      error: 'v1 API 默认关闭:本端点为平台级(API_KEYS 不绑定用户),返回全平台项目。' +
             '确认知悉后设 API_V1_ALLOW_CROSS_TENANT=1 开启;需要租户隔离请改用带用户令牌的 /api/projects。',
      code: 'cross_tenant_disabled',
    }, { status: 403 });
  }

  const url = req.nextUrl;
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20'), 1), 100);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0'), 0);
  const status = url.searchParams.get('status');

  try {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (status) { conds.push('status = ?'); params.push(status); }
    const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const rows = db.prepare(
      `SELECT id, title, description, status, cover_urls, created_at, updated_at
       FROM projects ${whereSql}
       ORDER BY updated_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as any[];

    const total = (db.prepare(`SELECT COUNT(*) AS n FROM projects ${whereSql}`).get(...params) as any)?.n ?? 0;

    return NextResponse.json({
      data: rows.map(r => ({
        id: r.id,
        title: r.title,
        description: r.description,
        status: r.status,
        coverUrls: safeJson<string[]>(r.cover_urls, []),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      pagination: { limit, offset, total },
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'internal_error', message: e instanceof Error ? e.message : 'unknown' },
      { status: 500 }
    );
  }
}

function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
