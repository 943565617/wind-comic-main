/**
 * v12.232 — 付费端点统一守卫(登录 + 预算,一次调用两件事)。
 *
 * 病根(对抗复检 CRITICAL):一批**会触发真实付费外部调用**的端点长期**零鉴权零预算** ——
 * `u2v/stream`(Minimax/Kling 视频 ¥0.5–3/次)、`narration/synthesize`(TTS 按字符)、
 * `character-traits/from-face` 与 `cameo/preview`(GPT-4o Vision ~$0.005/次)。
 * 匿名循环调用即可持续烧掉平台方的额度,且无任何记录归属。
 *
 * 为什么抽成一个函数:这类端点还会继续增加,散着写四份 if 迟早又漏一个 ——
 * v12.218/v12.230 两次「修了前门忘了侧门」的教训就在这。新增付费端点**只需一行**:
 *
 *   const g = await guardPaidEndpoint(request, { pendingCostCny: 1.8 });
 *   if (!g.ok) return g.response;
 *   // g.userId 可用于记账
 *
 * 注意 `pendingCostCny` 是**本次操作的预估成本**,用于「这一笔会不会把人顶过上限」的前瞻判断;
 * 传不传都能拦住已超额的用户,传了则能拦住「还差一点点就超」的那一笔。
 */
import { NextResponse } from 'next/server';
import { requireUser } from './auth-guard';
import { assertBudget } from './budget-enforce';

export type PaidGuardResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

export async function guardPaidEndpoint(
  request: Request,
  opts: { pendingCostCny?: number } = {},
): Promise<PaidGuardResult> {
  const u = requireUser(request);
  if (!u.ok) {
    return { ok: false, response: NextResponse.json({ message: u.message }, { status: u.status }) };
  }

  const { allow, guard } = await assertBudget({ userId: u.userId, pendingCostCny: opts.pendingCostCny });
  if (!allow) {
    // 402 Payment Required —— 语义比 403 准确:身份没问题,是额度不够。
    return {
      ok: false,
      response: NextResponse.json(
        { message: guard.message || '已达本月用量上限', guard, code: 'budget_exceeded' },
        { status: 402 },
      ),
    };
  }
  return { ok: true, userId: u.userId };
}
