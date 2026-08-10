import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth-guard';
import { getCharacter, updateCharacter, deleteCharacter } from '@/lib/repos/character-repo'; // v9.0.3c: async, 双驱动

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // v12.232(对抗复检补漏):此前**零鉴权** —— 知道 characterId 即可读取他人角色全部字段。
  // v12.218「鉴权总修」只修了 characters/route.ts(列表/创建),[id] 子路由漏网。
  const _u = requireUser(request);
  if (!_u.ok) return NextResponse.json({ message: _u.message }, { status: _u.status });
  const row = await getCharacter(id);
  if (!row) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }
  // 归属校验:非本人角色一律 404(不用 403 —— 避免泄露"该 id 存在"这一信息)
  if (row.user_id !== _u.userId) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    appearance: row.appearance,
    visualTags: JSON.parse(row.visual_tags || '[]'),
    imageUrls: JSON.parse(row.image_urls || '[]'),
    styleKeywords: row.style_keywords,
    usageCount: row.usage_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // v12.232(对抗复检补漏):删「无 token 回落 DB 第一个用户」——
  // 那等于**匿名即可改/删任意角色**,且改动记到第一注册用户头上。
  const _u = requireUser(request);
  if (!_u.ok) return NextResponse.json({ message: _u.message }, { status: _u.status });
  const userId = _u.userId;

  const row = await getCharacter(id);
  if (!row) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }
  // v12.232:此前拿到 row 后**从不比对 user_id** —— 已登录用户 B 可直接覆盖/删除用户 A 的角色。
  if (row.user_id !== userId) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const {
    name,
    description,
    appearance,
    visualTags,
    imageUrls,
    styleKeywords,
    usageCount,
  } = body;

  // v9.0.3c: 走 character-repo (双驱动); 每字段用现值兜底 (与原逻辑一致)
  const updated = await updateCharacter(id, {
    name: name ?? row.name,
    description: description ?? row.description,
    appearance: appearance ?? row.appearance,
    visualTags: visualTags ?? JSON.parse(row.visual_tags || '[]'),
    imageUrls: imageUrls ?? JSON.parse(row.image_urls || '[]'),
    styleKeywords: styleKeywords ?? row.style_keywords,
    usageCount: usageCount ?? row.usage_count,
  });
  if (!updated) return NextResponse.json({ message: 'Not found' }, { status: 404 });
  return NextResponse.json({
    id: updated.id,
    userId: updated.user_id,
    name: updated.name,
    description: updated.description,
    appearance: updated.appearance,
    visualTags: JSON.parse(updated.visual_tags || '[]'),
    imageUrls: JSON.parse(updated.image_urls || '[]'),
    styleKeywords: updated.style_keywords,
    usageCount: updated.usage_count,
    createdAt: updated.created_at,
    updatedAt: updated.updated_at,
  });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // v12.232(对抗复检补漏):删「无 token 回落 DB 第一个用户」——
  // 那等于**匿名即可改/删任意角色**,且改动记到第一注册用户头上。
  const _u = requireUser(request);
  if (!_u.ok) return NextResponse.json({ message: _u.message }, { status: _u.status });
  const userId = _u.userId;

  const row = await getCharacter(id);
  if (!row) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }
  // v12.232:此前拿到 row 后**从不比对 user_id** —— 已登录用户 B 可直接覆盖/删除用户 A 的角色。
  if (row.user_id !== userId) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }

  await deleteCharacter(id);

  return NextResponse.json({ message: 'Deleted' });
}
