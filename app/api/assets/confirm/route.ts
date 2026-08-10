import { NextRequest, NextResponse } from 'next/server';
import { setAssetsConfirmedByTypes, setAssetConfirmed } from '@/lib/repos/asset-repo';
import { requireProjectAccess } from '@/lib/auth-guard';

export const runtime = 'nodejs';

// POST /api/assets/confirm — 确认某个环节的资产，自动入库
export async function POST(request: NextRequest) {
  try {
    const { projectId, agentRole, assets } = await request.json();

    if (!projectId) {
      return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });
    }

    // v12.233(对抗复检收尾):此前**零鉴权** —— 任何人可确认他人项目的任意资产
    // (含 final_video/music/timeline),直接篡改流水线状态、**架空 enableGates 人工审核门**。
    // 确认资产属写操作,要 edit 级。
    const g = await requireProjectAccess(request, projectId, 'edit');
    if (!g.ok) return NextResponse.json({ message: g.message }, { status: g.status });

    // 根据 agentRole 确定要确认的资产类型
    const roleTypeMap: Record<string, string[]> = {
      writer: ['script'],
      character_designer: ['character'],
      scene_designer: ['scene'],
      storyboard: ['storyboard'],
      video_producer: ['video'],
      editor: ['timeline', 'final_video', 'music', 'video'],
      producer: ['final_video'],
    };

    const types = roleTypeMap[agentRole] || [];

    if (types.length > 0) {
      const changes = await setAssetsConfirmedByTypes(projectId, types);
      console.log(`[API] Confirmed ${changes} assets for ${agentRole} in project ${projectId}`);
    }

    // 如果传入了具体的 assets 数组，也逐个确认
    if (assets && Array.isArray(assets)) {
      for (const asset of assets) {
        if (asset.id) await setAssetConfirmed(asset.id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[API] Asset confirm failed:', e);
    return NextResponse.json({ error: 'Failed to confirm assets' }, { status: 500 });
  }
}
