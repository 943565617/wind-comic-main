/**
 * POST /api/templates/[id]/use · v9.6.8 — 记一次「用此模板起片」(use_count++),返回最新模板(含 payload)。
 */
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth-guard';
import { recordTemplateUse, getTemplate } from '@/lib/repos/template-repo';

export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // v12.234(二轮对抗复检):此前无鉴权,匿名循环 POST 即可把任意模板的 use_count 刷到任意高度 ——
  // 而 use_count 是模板市场的排序信号,等于把榜单开放给任何人白刷。
  const _g = await requireUser(request);
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });
  const { id } = await params;
  const ok = await recordTemplateUse(id);
  if (!ok) return NextResponse.json({ error: '模板不存在' }, { status: 404 });
  return NextResponse.json({ ok: true, template: await getTemplate(id) });
}
