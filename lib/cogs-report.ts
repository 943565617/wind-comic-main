/**
 * v12.224 — 单片 COGS(销货成本)报告(纯函数)。
 *
 * 病根尾(🔴-6):投资人尽调要真实 COGS(每片到底花多少算力)+ 毛利视角。
 * 在既有「逐引擎成本下钻」(rollupByEngine)之上,补:逐引擎**单价 × 用量 → 小计**、
 * 占比、总 COGS,以及给定参考售价时的**毛利率**。数字口径与 cost_log 一致(不重新估算,用真实记账)。
 */
import type { EngineRollup } from './cost-rollup';

export interface CogsLine {
  engine: string;
  count: number;            // 该引擎调用次数
  totalSec: number;         // 视频类累计秒数(图像/音频类为 0)
  unit: 'per_sec' | 'per_call';
  unitRateCny: number;      // 单价:视频类=¥/秒,其余=¥/次
  subtotalCny: number;      // = 真实记账小计(与 cost_log 一致)
  pct: number;              // 占总 COGS 百分比(0..100)
}

export interface CogsMargin {
  saleCny: number;          // 参考售价
  cogsCny: number;          // 总 COGS
  grossProfitCny: number;   // 毛利 = 售价 − COGS
  grossMarginPct: number;   // 毛利率 = 毛利 / 售价 × 100(售价 ≤0 时为 0)
}

export interface CogsReport {
  projectId?: string;
  totalCogsCny: number;
  lines: CogsLine[];
  margin: CogsMargin | null;
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * 从逐引擎汇总构建 COGS 报告。
 * @param rollups rollupByEngine 的输出(engine/count/costCny/durationSecTotal)
 * @param opts.saleCny 参考售价(给了才算毛利)
 */
export function buildCogsReport(
  rollups: EngineRollup[],
  opts: { projectId?: string; saleCny?: number | null } = {},
): CogsReport {
  const totalCogsCny = round2(rollups.reduce((t, r) => t + (Number(r.costCny) || 0), 0));
  const lines: CogsLine[] = rollups.map((r) => {
    const cost = Number(r.costCny) || 0;
    const sec = Number(r.durationSecTotal) || 0;
    const count = Number(r.count) || 0;
    const isPerSec = sec > 0;
    const unitRateCny = isPerSec
      ? round2(cost / sec)                       // ¥/秒
      : round2(cost / Math.max(1, count));       // ¥/次
    return {
      engine: r.engine,
      count,
      totalSec: round2(sec),
      unit: isPerSec ? 'per_sec' : 'per_call',
      unitRateCny,
      subtotalCny: round2(cost),
      pct: totalCogsCny > 0 ? Math.round((cost / totalCogsCny) * 1000) / 10 : 0,
    };
  });

  let margin: CogsMargin | null = null;
  if (opts.saleCny != null && Number.isFinite(opts.saleCny)) {
    const saleCny = round2(opts.saleCny);
    const grossProfitCny = round2(saleCny - totalCogsCny);
    margin = {
      saleCny,
      cogsCny: totalCogsCny,
      grossProfitCny,
      grossMarginPct: saleCny > 0 ? Math.round((grossProfitCny / saleCny) * 1000) / 10 : 0,
    };
  }

  return { projectId: opts.projectId, totalCogsCny, lines, margin };
}
