/**
 * POST /api/edit-intent/parse — 对话式编辑:自然语言 → 编辑意图(v12.248)。
 *
 * body: { text: string }
 * → 规则层解析成结构化意图 + 人话描述 + 是否含破坏性操作(需二次确认)。
 *
 * ## 只解析,不执行
 *
 * 本端点是**只读的**:它不删镜、不重配音、不动任何成片。返回的意图交给前端渲染成
 * 「我将:①… ②…」的确认卡,用户点确认后,前端再去调既有的 recompose / regenerate-shot 端点。
 * 这样破坏性/花钱的动作永远经过人确认,且复用现成能力。所以本端点只需登录守卫,不碰付费外呼。
 */
import { NextResponse, type NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth-guard';
import { parseEditIntent, describeIntents, hasDestructiveIntent } from '@/lib/edit-intent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 单次指令文本上限 —— 防超长 body,解析是 O(n) 正则,给足余量即可。 */
const MAX_TEXT_LEN = 2000;

export async function POST(request: NextRequest) {
  const g = requireUser(request);
  if (!g.ok) return NextResponse.json({ message: g.message }, { status: g.status });

  let body: any = {};
  try { body = await request.json(); } catch { /* empty */ }

  const text = typeof body?.text === 'string' ? body.text : '';
  if (!text.trim()) {
    return NextResponse.json({ message: '需要 text(想对成片做的修改,自然语言即可)' }, { status: 400 });
  }
  if (text.length > MAX_TEXT_LEN) {
    return NextResponse.json({ message: `指令过长(>${MAX_TEXT_LEN} 字),请分几句说` }, { status: 400 });
  }

  const { intents, unmatched } = parseEditIntent(text);

  return NextResponse.json({
    ok: true,
    // 明确告诉前端:这是 dry-run,后端没执行任何东西。
    dryRun: true,
    intents,
    describe: describeIntents(intents),
    destructive: hasDestructiveIntent(intents),
    unmatched,
    hint: unmatched
      ? '没听懂这句 —— 试试「删掉第3镜」「改成竖屏卡点字幕」「节奏快一点」「重新配音」这类说法。'
      : hasDestructiveIntent(intents)
        ? '含删镜/重生/重配音等花钱或不可逆操作 —— 前端需二次确认后才调既有端点执行。'
        : undefined,
  });
}
