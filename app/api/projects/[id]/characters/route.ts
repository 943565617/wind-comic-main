/**
 * /api/projects/[id]/characters (v12.198) — 项目建成后的多角色人脸档案。
 *
 * 病根:create 页有 1-3 角色锁脸,但项目建成后只有 CameoPanel 能锁「单个」主角 ——
 * 用户建完才想补/改配角人脸时无入口。本路由让项目详情页复用 CharacterLockSection
 * 管理最多 3 个角色档案,写回 projects.locked_characters(orchestrator 每镜注入 subject_reference,
 * 命中角色名的镜锁脸)+ 双写 project_locked_characters 归一表(跨项目角色推荐索引)。
 *
 * GET:读免鉴权(按 projectId 作用域,与 cost/health GET 同哲学);PUT:登录 + 本人项目。
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../auth/lib';
import { getProject, updateProjectById, upsertLockedCharacters } from '@/lib/repos/project-repo';
import { getDbDriver } from '@/lib/db-driver';
import { sanitizeLockedCharacters } from '@/lib/locked-characters';
import { requireProjectAccess } from '@/lib/auth-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // v12.230(鉴权复扫收口):本 GET 此前无鉴权 —— 知道 projectId 即可读取他人项目数据。
  const _g = await requireProjectAccess(request, id, 'view');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

  // getProject 的 COLS 不含 locked_characters(该列体量大,列表查询不需要)→ 专列取
  const row = await getDbDriver().get<{ locked_characters: string | null }>(
    'SELECT locked_characters FROM projects WHERE id = ?', [id],
  );
  if (!row) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
  let characters: unknown[] = [];
  try {
    const parsed = JSON.parse(row.locked_characters || '[]');
    if (Array.isArray(parsed)) characters = parsed;
  } catch { /* 非法 JSON → 空 */ }
  return NextResponse.json({ projectId: id, characters, max: 3 });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const project = await getProject(id);
  if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
  if ((project as any).user_id && (project as any).user_id !== payload.sub) {
    return NextResponse.json({ error: '无权修改该项目' }, { status: 403 });
  }

  let body: any = {};
  try { body = await request.json(); } catch {}
  // 净化与 create-pipeline 逐字节同源(白名单 + 硬上限 3),挡任意 JSON 注入
  const sanitized = sanitizeLockedCharacters(body?.characters);

  // 双写:projects.locked_characters(orchestrator 每镜注入读它)+ 归一表(跨项目索引)
  await updateProjectById(id, { locked_characters: JSON.stringify(sanitized) });
  await upsertLockedCharacters(id, sanitized);

  return NextResponse.json({ ok: true, projectId: id, characters: sanitized, count: sanitized.length });
}
