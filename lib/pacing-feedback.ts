/**
 * v12.284 — 节奏审计 → 编剧反馈闭环。
 *
 * 病根:`buildWriterFeedbackHint`(lib/quality-scores.ts)只看 **face / lighting / continuity**
 * 三个**画面**维度;节奏审计的结论(拖沓段、高开低走、开场弱、时长呆板)**从不回流编剧**。
 * 于是审计能指出「第 3~5 镜拖沓」,下一轮生成却完全不知道 —— **诊断出来了,却没进闭环**。
 *
 * 这条最贴本项目的价值主张:市场数据里制作只占成本 7.5%、爆款率 <0.1%,
 * 工具的价值在**降废片率**;而降废片率的关键不是"报出问题",是"下一版别再犯"。
 *
 * 设计取舍:
 *   · 只翻译**能指导写作**的结论。「平均分 5.2」「斜率 -1.66」这类数字对编剧没有可操作性,不进 prompt;
 *   · 指令写成**正向要求**(该怎么写),而不是罗列上一版的错 —— LLM 对"做什么"比"别做什么"响应更好;
 *   · 有上限:最多注入 4 条,避免挤占 prompt 预算把创作空间压没了。
 */

export interface PacingFeedbackInput {
  /** 上一版的 PacingAuditReport(含 v2 诊断);无则返回空串 */
  report?: {
    passed?: boolean;
    reversalCount?: number;
    v2?: {
      shape?: { shape?: string; peakIndex?: number };
      dragSegments?: Array<{ fromShot: number; toShot: number; length: number; avgScore: number }>;
      opening?: { passed?: boolean; sampled?: number; avgScore?: number };
      durationRhythm?: { cv?: number; longestRun?: number; sampled?: number };
    };
  } | null;
  /** 本次计划的镜头数,用于把"上一版第 N 镜"换算成相对位置(镜数可能变) */
  plannedShots?: number;
}

const MAX_HINTS = 4;

/**
 * 把上一版节奏审计翻译成 Writer 的正向写作要求。
 * 无报告 / 无可操作结论 → 返回空串(调用方据此决定是否拼接)。
 */
export function buildPacingFeedbackHint(input: PacingFeedbackInput): string {
  const r = input?.report;
  if (!r) return '';
  const v2 = r.v2;
  const hints: string[] = [];

  // ① 拖沓段 —— 最具体、最该先给
  const drags = Array.isArray(v2?.dragSegments) ? v2!.dragSegments! : [];
  if (drags.length > 0) {
    const longest = drags.reduce((a, b) => (b.length > a.length ? b : a), drags[0]);
    const total = drags.reduce((n, d) => n + d.length, 0);
    hints.push(
      `【上一版有 ${drags.length} 段拖沓(共 ${total} 镜,最长第 ${longest.fromShot}~${longest.toShot} 镜)】` +
      `本版每一镜都要有**事件发生**:或推进目标、或制造阻碍、或翻转关系。` +
      `连续三镜以上只有情绪铺陈而无事件的段落,直接合并或删掉。`,
    );
  }

  // ② 曲线形状 —— 高开低走 / 无高潮 各给不同要求
  const shape = v2?.shape?.shape;
  if (shape === 'front-loaded') {
    hints.push(
      `【上一版高开低走(高潮出现在第 ${v2?.shape?.peakIndex} 镜就早早用完)】` +
      `本版把最强冲突**留到后段**:前段只铺设赌注与悬念,让强度层层加码,最后 1/4 才引爆。`,
    );
  } else if (shape === 'no-climax') {
    hints.push(
      `【上一版全程温吞,没有明显高潮】` +
      `本版必须指定 1~2 镜作为**顶点**:那几镜的冲突强度要明显高于其余(代价最大、翻转最狠),不要平均用力。`,
    );
  } else if (shape === 'flat') {
    hints.push(
      `【上一版冲突强度接近平铺,缺少推进感】` +
      `本版让每一幕的赌注比上一幕更高一档,形成可感知的升级链条。`,
    );
  }

  // ③ 开场 —— 完播率由这里决定
  if (v2?.opening && v2.opening.passed === false) {
    hints.push(
      `【上一版开场不够抓人(前 ${v2.opening.sampled} 镜强度偏低)】` +
      `本版**第一镜就要有钩子**:直接从冲突/异常/悬念切入,不要用交代背景开场。`,
    );
  }

  // ④ 时长节奏 —— 只在明显呆板时提
  // ⚠️ 判别要看 `sampled` 而不是 `cv > 0`:auditDurationRhythm 在**样本不足(<3 镜)**时也返回
  // cv=0,而 **cv=0 恰恰是「全片等长」这个最呆板的情况** —— 早先用 `cv > 0` 排除无数据,
  // 结果把最该报警的案例一并排除了(测试当场抓到)。样本数缺省时按有数据处理(向后兼容旧报告)。
  const dr = v2?.durationRhythm;
  const sampled = typeof dr?.sampled === 'number' ? dr.sampled : 3;
  const cv = dr?.cv;
  const run = dr?.longestRun ?? 0;
  if (sampled >= 3 && typeof cv === 'number' && cv < 0.12) {
    hints.push(
      `【上一版镜头时长几乎一致,观感呆板】` +
      `本版有意做**疏密对比**:紧张段用短镜快切,情绪段留长镜呼吸。`,
    );
  } else if (sampled >= 3 && run >= 3) {
    hints.push(
      `【上一版有连续 ${run} 个长镜堆叠】` +
      `本版避免长镜连排,中间插入短镜换气。`,
    );
  }

  if (hints.length === 0) return '';
  const picked = hints.slice(0, MAX_HINTS);
  return `\n\n## 📉 上一版节奏诊断(务必针对性改进)\n${picked.map((h) => `- ${h}`).join('\n')}\n`;
}

/** 是否有可回流的节奏问题(调用方可据此决定要不要发 agentTalk 提示)。 */
export function hasPacingFeedback(input: PacingFeedbackInput): boolean {
  return buildPacingFeedbackHint(input).length > 0;
}

/**
 * 读取该项目**上一版**落库的节奏审计报告。
 * 依赖 v12.278 起 `saveAsset(projectId,'script',…)` 带上了 `pacingReport` ——
 * 在那之前的老项目没有该字段,此处自然返回 null,不报错。
 */
export async function getLatestPacingReport(projectId: string): Promise<any | null> {
  if (!projectId) return null;
  try {
    const { listAssetsByType } = await import('@/lib/repos/asset-repo');
    const rows = await listAssetsByType(projectId, 'script');
    if (!rows || rows.length === 0) return null;
    const data = JSON.parse((rows[0] as any)?.data || '{}');
    return data?.pacingReport ?? null;
  } catch {
    return null; // 读不到就当没有 —— 反馈是增强项,不该阻塞创作
  }
}
