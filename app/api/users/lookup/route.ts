/**
 * v3.0 P0.1 — Lightweight user name lookup for @-mention autocomplete.
 *
 * GET /api/users/lookup?q=张 → { users: [{ id, name, avatarUrl }] }
 *
 * 严格限制:
 *   - 必须登录 (防匿名爬用户库)
 *   - q ≥ 1 char, ≤ 30
 *   - 上限 10 条结果
 *   - 只返 id / name / avatar — 不泄 email / role 等
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../../auth/lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // v12.234(二轮对抗复检):原来只在 NODE_ENV==='production' 才 401 —— 而 staging/预览环境
  // 通常也挂在公网上且 NODE_ENV 并非 production,等于把**全站用户名前缀检索**开放给匿名访问。
  // 「dev 没设 JWT_SECRET」不是放开鉴权的理由:本地开发登录一下即可,不该拿线上环境的口子来换。
  const payload = getUserFromRequest(request);
  if (!payload) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const q = (request.nextUrl.searchParams.get('q') || '').trim().slice(0, 30);
  if (!q) return NextResponse.json({ users: [] });

  // LIKE 'q%' — 前缀匹配 (更贴 @ 补全用法). 大小写不敏感.
  const rows = db
    .prepare(`SELECT id, name, avatar_url FROM users WHERE LOWER(name) LIKE LOWER(?) ORDER BY name LIMIT 10`)
    .all(`${q}%`) as Array<{ id: string; name: string; avatar_url: string | null }>;

  return NextResponse.json({
    users: rows.map((r) => ({ id: r.id, name: r.name, avatarUrl: r.avatar_url })),
  });
}
