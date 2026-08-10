import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { updateProjectById } from '@/lib/repos/project-repo';
import { persistAsset } from '@/lib/asset-storage';
import { requireProjectAccess } from '@/lib/auth-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/projects/:id/cameo
 *
 * P0 Cameo —— 上传项目级主角脸参考图,锁死全片 IP 不跳脸。
 *
 * 接受 multipart/form-data 或 JSON { imageUrl }(外链/data: URI)。
 * 成功后把持久化 URL 写进 projects.primary_character_ref,
 * orchestrator 生成每个 shot 时会把它塞进 subject_reference[0],
 * 连带 Character Bible / Style Keywords 一起锁住角色一致性。
 *
 * 返回: { url: string, size: number }
 *
 * DELETE: 解绑(把字段置 null)
 * GET:    读当前已设置的参考图
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  // v12.230(鉴权复扫收口):v12.218「鉴权总修」只修了对抗报告点名的端点,未系统复扫
  // projects/[id]/** —— 本路由当时漏网,任何人知道 projectId 即可调用。
  const _g = await requireProjectAccess(request, projectId, 'edit');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });


  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!project) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }

  try {
    const contentType = request.headers.get('content-type') || '';
    let persistInputUrl: string | null = null;
    let buffer: Buffer | null = null;

    if (contentType.startsWith('multipart/form-data')) {
      // 路径 1: 表单上传
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof Blob)) {
        return NextResponse.json({ error: 'missing file field' }, { status: 400 });
      }
      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json({ error: 'file too large (max 10MB)' }, { status: 413 });
      }
      buffer = Buffer.from(await file.arrayBuffer());
    } else {
      // 路径 2: JSON body 带 imageUrl(可以是外链、data:、或 /api/serve-file)
      const body = await request.json().catch(() => null);
      if (!body?.imageUrl || typeof body.imageUrl !== 'string') {
        return NextResponse.json({ error: 'imageUrl required' }, { status: 400 });
      }
      // v12.237(第四轮对抗复检):此前 imageUrl 无前缀校验,裸本地路径会走 persistAsset 的
      // 绝对路径 fallback 读任意文件。只允许 http(s) / data: / 站内 serve-file(后者还会验签)。
      if (!/^(https?:|data:|\/api\/serve-file)/.test(body.imageUrl)) {
        return NextResponse.json({ error: 'imageUrl 协议非法(仅 http(s)/data:/serve-file)' }, { status: 400 });
      }
      persistInputUrl = body.imageUrl;
    }

    // 走 persistAsset 统一落盘,保证返回稳定 URL
    // 对于 buffer 路径,我们 wrap 成 data: URI 让 persistAsset 统一处理(多走一步但逻辑简单)
    let persisted;
    if (buffer) {
      const dataUri = `data:image/png;base64,${buffer.toString('base64')}`;
      persisted = await persistAsset(dataUri, { contentType: 'image/png' });
    } else if (persistInputUrl) {
      persisted = await persistAsset(persistInputUrl);
    }

    if (!persisted) {
      return NextResponse.json({ error: 'failed to persist image' }, { status: 500 });
    }

    // 写入 projects 表 (v9.0.2: 走 project-repo, 双驱动)
    await updateProjectById(projectId, { primary_character_ref: persisted.url });

    console.log(`[Cameo] project ${projectId} primary face set → ${persisted.url}`);

    return NextResponse.json({
      url: persisted.url,
      size: persisted.size,
      contentType: persisted.contentType,
    });
  } catch (e) {
    console.error('[Cameo] upload failed:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'upload failed' },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  // v12.230(鉴权复扫收口):v12.218「鉴权总修」只修了对抗报告点名的端点,未系统复扫
  // projects/[id]/** —— 本路由当时漏网,任何人知道 projectId 即可调用。
  const _g = await requireProjectAccess(request, projectId, 'view');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

  const row = db.prepare('SELECT primary_character_ref FROM projects WHERE id = ?').get(projectId) as
    | { primary_character_ref: string | null }
    | undefined;
  if (!row) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  return NextResponse.json({ url: row.primary_character_ref || null });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  // v12.230(鉴权复扫收口):v12.218「鉴权总修」只修了对抗报告点名的端点,未系统复扫
  // projects/[id]/** —— 本路由当时漏网,任何人知道 projectId 即可调用。
  const _g = await requireProjectAccess(request, projectId, 'edit');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 });

  await updateProjectById(projectId, { primary_character_ref: null });
  return NextResponse.json({ success: true });
}
