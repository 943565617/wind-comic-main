/**
 * /api/projects/[id]/continuity · v7.3 — 项目级连贯性设置 (种子锁 / 链接模式 / 强度 / 锁开关 / FaceID)
 *
 * GET  → { settings }                 读当前设置 (无则默认)
 * POST { settings } → { ok, settings } 保存 (upsert 到 project_assets type='continuity' 单行)
 *
 * 不重生成任何资产 — 仅持久化设置, 供后续逐镜生成/重生成时消费 (compileContinuityDirectives)。
 */

import { NextRequest, NextResponse } from 'next/server';
import { listAssetsByType, createAsset, updateAsset } from '@/lib/repos/asset-repo';
import { normalizeContinuitySettings, defaultContinuitySettings } from '@/lib/continuity';
import { requireProjectAccess } from '@/lib/auth-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ASSET_NAME = 'continuity-settings';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  // v12.230(鉴权复扫收口):v12.218「鉴权总修」只修了对抗报告点名的端点,未系统复扫
  // projects/[id]/** —— 本路由当时漏网,任何人知道 projectId 即可调用。
  const _g = await requireProjectAccess(request, projectId, 'view');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

  const rows = await listAssetsByType(projectId, 'continuity');
  if (!rows.length) return NextResponse.json({ settings: defaultContinuitySettings() });
  let data: any = {};
  try { data = JSON.parse(rows[0].data || '{}'); } catch { data = {}; }
  return NextResponse.json({ settings: normalizeContinuitySettings(data) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  // v12.230(鉴权复扫收口):v12.218「鉴权总修」只修了对抗报告点名的端点,未系统复扫
  // projects/[id]/** —— 本路由当时漏网,任何人知道 projectId 即可调用。
  const _g = await requireProjectAccess(request, projectId, 'edit');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

  let body: any = {};
  try { body = await request.json(); } catch { /* swallow */ }

  const settings = normalizeContinuitySettings(body?.settings ?? body);

  const rows = await listAssetsByType(projectId, 'continuity');
  if (rows.length) {
    const ok = await updateAsset(rows[0].id, { data: settings });
    if (!ok) return NextResponse.json({ error: '保存失败' }, { status: 500 });
  } else {
    await createAsset({ projectId, type: 'continuity', name: ASSET_NAME, data: settings });
  }
  return NextResponse.json({ ok: true, settings });
}
