/**
 * 项目作用域鉴权守卫(v12.218.0)。
 *
 * 病根(对抗尽调 🔴-2/🟠-10 已亲验):多个项目作用域端点要么裸奔(枚举 projectId 读任意人数据),
 * 要么无 token 时「回落 DB 第一个用户」——匿名即得他人项目/角色/用量。本模块把「谁能碰这个项目」
 * 收敛成一处:复用 project-share 的角色体系(owner→editor,协作者按 role),统一返回 401/403。
 *
 * 用法(路由内):
 *   const g = await requireProjectAccess(request, id, 'view');   // 或 'edit'
 *   if (!g.ok) return NextResponse.json({ message: g.message }, { status: g.status });
 *   // g.userId 可用
 */
import { getUserFromRequest } from '@/app/api/auth/lib';
import { getUserProjectRole } from '@/lib/project-share';

export type AccessLevel = 'view' | 'edit';

export type GuardResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; message: string };

/** 仅要求登录(非项目作用域端点用,如账户/用量列表)。 */
export function requireUser(request: Request): { ok: true; userId: string } | { ok: false; status: 401; message: string } {
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return { ok: false, status: 401, message: 'Unauthorized' };
  return { ok: true, userId: payload.sub };
}

/**
 * 要求对项目有 view 或 edit 权限。owner 视为 editor;协作者按 project_collaborators.role。
 * view:任意角色(viewer/commenter/editor);edit:仅 editor(含 owner)。
 */
export async function requireProjectAccess(request: Request, projectId: string, level: AccessLevel = 'view'): Promise<GuardResult> {
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return { ok: false, status: 401, message: 'Unauthorized' };
  const role = await getUserProjectRole(projectId, payload.sub);
  if (!role) return { ok: false, status: 403, message: 'Forbidden' };
  if (level === 'edit' && role !== 'editor') return { ok: false, status: 403, message: 'Forbidden (editor required)' };
  return { ok: true, userId: payload.sub };
}
