/**
 * v12.275 — 节奏审计 v2:从「打分」到「诊断」。
 *
 * 为什么做这一层(2026-08-07 竞品核验的直接结论):
 *   · 全部已查竞品(含首个同构开源竞品港大 ViMax)**都没有节奏审计** —— 这是本项目最实的护城河;
 *   · 市场侧数据更说明问题:AI 短剧爆款率 <0.1%、约 90% 公司亏损,而制作成本仅占总盘 7.5%
 *     —— 所以工具的价值不在「更便宜地出片」,而在**降废片率**。审计要能指出「改哪几镜」。
 *
 * v1(v2.21)已有:逐镜冲突分、相邻镜情绪极性反转、平均分/反转密度、钩子三指标。
 * v1 结构上**看不见**的四件事,正是本版补的:
 *   ① 冲突曲线**形状** —— 平均分会把「高开低走」和「层层递进」算成同一个数;
 *   ② **拖沓段定位** —— 报「平均 5.2 分」没用,要指出第几到第几镜是观众划走的地方;
 *   ③ **开场密度** —— 完播率由前段决定(平台分账看完播),开场必须单独体检;
 *   ④ **时长节奏** —— 全片等长呆板、长镜堆叠拖沓,而 v1 完全没看 duration。
 *
 * 全部纯函数 + 既有字段,零 LLM 成本、零额外调用。
 */

export interface V2Shot {
  shotNumber?: number;
  duration?: number;
}

/** 冲突曲线形状诊断结果。 */
export interface ConflictShape {
  /** 线性拟合斜率:>0 递进,≈0 平铺,<0 走低 */
  slope: number;
  /** 峰值所在镜(1-based 序号,取 conflict 最高的一镜) */
  peakIndex: number;
  /** 峰值出现在全片的相对位置 0~1 */
  peakPosition: number;
  /** 峰值高出均值多少(张力显著度) */
  peakProminence: number;
  shape: 'escalating' | 'flat' | 'front-loaded' | 'no-climax';
  warning: string | null;
}

/** 最小二乘斜率(x 取 0..n-1)。样本 <2 返回 0。 */
export function conflictSlope(scores: number[]): number {
  const n = scores.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = scores.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (scores[i] - my);
    den += (i - mx) * (i - mx);
  }
  return den === 0 ? 0 : num / den;
}

/**
 * 诊断冲突曲线形状。短剧的理想形是「总体走高 + 高潮靠后」。
 * 三种病:平铺(无张力累积)、高开低走(后段划走)、无显著高潮(全程温吞)。
 */
export function analyzeConflictShape(scores: number[]): ConflictShape {
  const n = scores.length;
  if (n === 0) {
    return { slope: 0, peakIndex: 0, peakPosition: 0, peakProminence: 0, shape: 'flat', warning: null };
  }
  const slope = conflictSlope(scores);
  let peak = 0;
  for (let i = 1; i < n; i++) if (scores[i] > scores[peak]) peak = i;
  const avg = scores.reduce((a, b) => a + b, 0) / n;
  const peakProminence = scores[peak] - avg;
  const peakPosition = n === 1 ? 1 : peak / (n - 1);

  let shape: ConflictShape['shape'] = 'flat';
  let warning: string | null = null;

  if (peakProminence < 1.5) {
    shape = 'no-climax';
    warning = `全片冲突强度起伏不足(峰值仅高出均值 ${peakProminence.toFixed(1)} 分)—— 没有明确高潮,观众全程温吞。建议挑 1~2 镜把冲突推到顶。`;
  } else if (slope < -0.15) {
    shape = 'front-loaded';
    warning = `冲突曲线整体走低(斜率 ${slope.toFixed(2)}),高潮出现在第 ${peak + 1} 镜(全片 ${(peakPosition * 100).toFixed(0)}% 处)—— 高开低走,后半段最容易被划走。建议把强冲突镜后移或在后段补反转。`;
  } else if (slope > 0.15) {
    shape = 'escalating';
  } else {
    shape = 'flat';
    warning = `冲突曲线接近平铺(斜率 ${slope.toFixed(2)})—— 每镜强度相近,缺少层层加码的推进感。`;
  }
  return { slope, peakIndex: peak + 1, peakPosition, peakProminence, shape, warning };
}

/** 拖沓段:连续 ≥minRun 镜低于阈值。返回 1-based 闭区间。 */
export interface DragSegment {
  fromShot: number;
  toShot: number;
  length: number;
  avgScore: number;
}

export function findDragSegments(
  scores: number[],
  opts?: { threshold?: number; minRun?: number },
): DragSegment[] {
  const threshold = opts?.threshold ?? 3;
  const minRun = opts?.minRun ?? 3;
  const out: DragSegment[] = [];
  let start = -1;
  const flush = (endExclusive: number) => {
    if (start < 0) return;
    const len = endExclusive - start;
    if (len >= minRun) {
      const seg = scores.slice(start, endExclusive);
      out.push({
        fromShot: start + 1,
        toShot: endExclusive,
        length: len,
        avgScore: seg.reduce((a, b) => a + b, 0) / len,
      });
    }
    start = -1;
  };
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] < threshold) { if (start < 0) start = i; }
    else flush(i);
  }
  flush(scores.length);
  return out;
}

/** 开场体检:完播率由前段决定,单独看。 */
export interface OpeningDensity {
  /** 参与统计的开场镜数 */
  sampled: number;
  avgScore: number;
  reversals: number;
  passed: boolean;
  warning: string | null;
}

export function auditOpening(
  scores: number[],
  reversalPairs: Array<{ fromShot: number; toShot: number }>,
  opts?: { minAvg?: number; dramaMode?: boolean },
): OpeningDensity {
  const n = scores.length;
  if (n === 0) return { sampled: 0, avgScore: 0, reversals: 0, passed: true, warning: null };
  // 取前 1/3,至少 2 镜、至多 5 镜
  const sampled = Math.max(1, Math.min(5, Math.max(2, Math.ceil(n / 3))));
  const head = scores.slice(0, sampled);
  const avgScore = head.reduce((a, b) => a + b, 0) / head.length;
  const reversals = reversalPairs.filter((r) => r.toShot <= sampled).length;
  const minAvg = opts?.minAvg ?? (opts?.dramaMode ? 5 : 3.5);
  const passed = avgScore >= minAvg;
  return {
    sampled,
    avgScore,
    reversals,
    passed,
    warning: passed
      ? null
      : `开场前 ${sampled} 镜平均冲突分仅 ${avgScore.toFixed(1)}(要求 ≥${minAvg})—— 完播率主要由开场决定,这里不抓人后面再好也没人看到。`,
  };
}

/** 时长节奏:全片等长呆板,长镜堆叠拖沓。 */
export interface DurationRhythm {
  sampled: number;
  mean: number;
  /** 变异系数 = 标准差 / 均值;越低越单调 */
  cv: number;
  longestRun: number;
  warning: string | null;
}

export function auditDurationRhythm(shots: V2Shot[], opts?: { minCv?: number }): DurationRhythm {
  const ds = shots.map((s) => Number(s?.duration)).filter((d) => Number.isFinite(d) && d > 0);
  if (ds.length < 3) return { sampled: ds.length, mean: 0, cv: 0, longestRun: 0, warning: null };
  const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
  const variance = ds.reduce((a, d) => a + (d - mean) * (d - mean), 0) / ds.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  // 连续长镜(> 均值 1.4 倍)堆叠长度
  let run = 0, longestRun = 0;
  for (const d of ds) {
    if (d > mean * 1.4) { run++; longestRun = Math.max(longestRun, run); } else run = 0;
  }
  const minCv = opts?.minCv ?? 0.12;
  let warning: string | null = null;
  if (cv < minCv) {
    warning = `镜头时长几乎一致(变异系数 ${cv.toFixed(2)})—— 缺少快切与长镜的疏密对比,观感呆板。`;
  } else if (longestRun >= 3) {
    warning = `有连续 ${longestRun} 个长镜堆叠(均超全片均长 40%)—— 这段最容易拖沓,建议插入快切或拆镜。`;
  }
  return { sampled: ds.length, mean, cv, longestRun, warning };
}

/** v2 汇总。 */
export interface PacingV2Report {
  shape: ConflictShape;
  dragSegments: DragSegment[];
  opening: OpeningDensity;
  durationRhythm: DurationRhythm;
  /** 汇总后的可执行建议(指到具体镜号) */
  actionable: string[];
}

export function auditPacingV2(
  shots: V2Shot[],
  conflictScores: number[],
  reversalPairs: Array<{ fromShot: number; toShot: number }>,
  opts?: { dramaMode?: boolean },
): PacingV2Report {
  const shape = analyzeConflictShape(conflictScores);
  const dragSegments = findDragSegments(conflictScores, { threshold: opts?.dramaMode ? 4 : 3 });
  const opening = auditOpening(conflictScores, reversalPairs, { dramaMode: opts?.dramaMode });
  const durationRhythm = auditDurationRhythm(shots);

  const actionable: string[] = [];
  if (opening.warning) actionable.push(opening.warning);
  if (shape.warning) actionable.push(shape.warning);
  for (const d of dragSegments) {
    actionable.push(
      `第 ${d.fromShot}~${d.toShot} 镜连续 ${d.length} 镜低冲突(均分 ${d.avgScore.toFixed(1)})—— 这是最可能被划走的一段,建议合并、删减或在其中插一次反转。`,
    );
  }
  if (durationRhythm.warning) actionable.push(durationRhythm.warning);

  return { shape, dragSegments, opening, durationRhythm, actionable };
}
