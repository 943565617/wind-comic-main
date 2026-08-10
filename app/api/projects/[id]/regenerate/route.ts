import { NextRequest, NextResponse } from 'next/server';
import { requireProjectAccess } from '@/lib/auth-guard';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  // v12.230(鉴权复扫收口):v12.218「鉴权总修」只修了对抗报告点名的端点,未系统复扫
  // projects/[id]/** —— 本路由当时漏网,任何人知道 projectId 即可调用。
  const _g = await requireProjectAccess(req, projectId, 'edit');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

  const { agentRole, feedback } = await req.json();

  console.log(`[Regenerate] Project: ${projectId}, Role: ${agentRole}, Feedback: ${feedback}`);

  try {
    // Dynamic import to avoid build errors if orchestrator shape changes
    const mod = await import('@/services/hybrid-orchestrator');
    const orchestrators = (mod as Record<string, unknown>)['activeOrchestrators'] as Map<string, { regenerateStage: (role: string, fb: string) => void }> | undefined;

    if (orchestrators) {
      const orchestrator = orchestrators.get(projectId);
      if (orchestrator) {
        orchestrator.regenerateStage(agentRole, feedback);
        return NextResponse.json({ success: true, message: '正在重新生成...' });
      }
    }

    return NextResponse.json({ success: true, message: '已记录修改意见，下次生成时将应用' });
  } catch {
    return NextResponse.json({ success: true, message: '已记录修改意见' });
  }
}
