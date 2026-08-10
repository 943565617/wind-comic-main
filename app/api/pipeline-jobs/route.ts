/**
 * GET /api/pipeline-jobs (v10.4.2) — 流水线任务列表(死信 UI 消费)。
 * ?state=failed|queued|running|done 过滤;默认最近 50 条全状态。
 * 鉴权:登录 + **按本人过滤**(v12.233:此前无 user 过滤,任意登录用户可枚举全平台任务,
 * 含他人 projectId 与创意预览。原注释「单租户演示语义」是给漏洞背书 —— 生产即多租户)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '../auth/lib';
import { listPipelineJobs, type PipelineJobState } from '@/lib/repos/pipeline-job-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATES: PipelineJobState[] = ['queued', 'running', 'done', 'failed'];

export async function GET(request: NextRequest) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  const raw = request.nextUrl.searchParams.get('state') || '';
  const state = (STATES as string[]).includes(raw) ? (raw as PipelineJobState) : undefined;
  const jobs = await listPipelineJobs({ state, limit: 50, userId: payload.sub });
  // payload 体积大(完整创意输入)且对列表无用 → 只回标题摘要
  const slim = jobs.map((j) => ({
    id: j.id, type: j.type, projectId: j.projectId, state: j.state, step: j.step,
    attempts: j.attempts, lastError: j.lastError, heartbeatAt: j.heartbeatAt,
    createdAt: j.createdAt, updatedAt: j.updatedAt,
    ideaPreview: typeof j.payload?.idea === 'string' ? j.payload.idea.slice(0, 60) : '',
  }));
  return NextResponse.json({ jobs: slim, workerActive: process.env.PIPELINE_QUEUE === '1' });
}
