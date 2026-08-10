import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../auth/lib';
import { listCharactersByUser, createCharacter } from '@/lib/repos/character-repo'; // v9.0.3c: async, 双驱动

export const runtime = 'nodejs';

export async function GET(request: Request) {
  // v12.218(安全止血):删回落首用户 —— 匿名即得他人角色库。无 token → 401。
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const userId = payload.sub;

  const rows = await listCharactersByUser(userId);

  const data = rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    description: r.description,
    appearance: r.appearance,
    visualTags: JSON.parse(r.visual_tags || '[]'),
    imageUrls: JSON.parse(r.image_urls || '[]'),
    styleKeywords: r.style_keywords,
    usageCount: r.usage_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  return NextResponse.json(data);
}

export async function POST(request: Request) {
  // v12.218:删回落首用户,无 token → 401
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const userId = payload.sub;

  const body = await request.json().catch(() => ({}));
  const { name, description, appearance, visualTags, imageUrls, styleKeywords } = body;

  if (!name) {
    return NextResponse.json({ message: 'Missing name' }, { status: 400 });
  }

  // v9.0.3c: 走 character-repo (双驱动); 返回落库后的真实行
  const row = await createCharacter({ userId, name, description, appearance, visualTags, imageUrls, styleKeywords });

  return NextResponse.json(
    {
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
    },
    { status: 201 }
  );
}
