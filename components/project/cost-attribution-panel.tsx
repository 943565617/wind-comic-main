'use client';

/**
 * v9.6.5 — 项目级成本归因面板(阶段十六 T3 性能成本)。拉 /api/projects/[id]/cost
 * (cost_log → engine 归类 → lib/cost-attribution),展示:总成本 + 各类目占比(降序条形)
 * + 最贵类目 + 省钱提示。挂在「技术监看」tab(与性能监看同列)。无成本数据 → 空态提示。
 *
 * v12.41 设计系统统一:整面板从旁路 Tailwind(rounded-xl/bg-white/硬编码色盘)迁到 cinema-*
 * 令牌,消灭"风格孤岛";类目色 / 护栏色全部走 cinema 调色板,emoji → Phosphor 图标。
 */
import { useEffect, useMemo, useState } from 'react';
import { CurrencyCny, Lightbulb } from '@phosphor-icons/react';
import { EmptyState } from '@/components/cinema/primitives';
import { evaluateCostGuard } from '@/lib/cost-attribution';

const GUARD_CLS: Record<'none' | 'ok' | 'warn' | 'over', string> = {
  none: 'text-[var(--cinema-text-3)]', ok: 'text-[var(--cinema-green)]', warn: 'text-[var(--cinema-amber)]', over: 'text-[var(--cinema-red)]',
};
const GUARD_BAR: Record<'none' | 'ok' | 'warn' | 'over', string> = {
  none: 'bg-[var(--cinema-border-hi)]', ok: 'bg-[var(--cinema-green)]', warn: 'bg-[var(--cinema-amber)]', over: 'bg-[var(--cinema-red)]',
};

type CostCategory = 'llm' | 'image' | 'video' | 'tts' | 'lipsync' | 'other';
interface CategoryCost { category: CostCategory; label: string; costCny: number; pct: number; count: number; }
interface CostAttribution {
  totalCny: number;
  byCategory: CategoryCost[];
  topCategory: CategoryCost | null;
  hints: string[];
}

// v12.41 类目色 → cinema 调色板(6 个语义令牌,低饱和暗金体系,告别 neon 硬编码)
const CAT_COLOR: Record<CostCategory, string> = {
  llm: 'var(--cinema-amber)', image: 'var(--cinema-green)', video: 'var(--cinema-magenta)',
  tts: 'var(--cinema-blue)', lipsync: 'var(--cinema-violet)', other: 'var(--cinema-text-3)',
};

const CAP_KEY = (id: string) => `qfmj-cost-cap-${id}`;

// v12.224 单片 COGS 报告结构(与 lib/cogs-report 对齐)
interface CogsLine { engine: string; count: number; totalSec: number; unit: 'per_sec' | 'per_call'; unitRateCny: number; subtotalCny: number; pct: number; }
interface CogsReport { totalCogsCny: number; lines: CogsLine[]; margin: { saleCny: number; cogsCny: number; grossProfitCny: number; grossMarginPct: number } | null; }

export function CostAttributionPanel({ projectId }: { projectId: string }) {
  const [attr, setAttr] = useState<CostAttribution | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [cap, setCap] = useState('');
  // v12.224:COGS/毛利下钻(投资人视角)
  const [cogs, setCogs] = useState<CogsReport | null>(null);
  const [showCogs, setShowCogs] = useState(false);
  const [sale, setSale] = useState('');

  const loadCogs = async (saleCny: string) => {
    try {
      const q = saleCny.trim() && Number(saleCny) > 0 ? `&sale=${Number(saleCny)}` : '';
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/cost?report=cogs${q}`);
      if (res.ok) setCogs(await res.json());
    } catch { /* 静默:增强信息 */ }
  };

  useEffect(() => {
    let alive = true;
    try { const v = localStorage.getItem(CAP_KEY(projectId)); if (v) setCap(v); } catch { /* ignore */ }
    (async () => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/cost`);
        const body = await res.json();
        if (alive && res.ok) setAttr(body.attribution as CostAttribution);
      } catch { /* 静默:增强信息 */ }
      finally { if (alive) setLoaded(true); }
    })();
    return () => { alive = false; };
  }, [projectId]);

  const capNum = cap.trim() !== '' && Number.isFinite(Number(cap)) ? Number(cap) : null;
  const guard = useMemo(() => evaluateCostGuard({ totalCny: attr?.totalCny || 0, capCny: capNum }), [attr, capNum]);
  const onCapChange = (v: string) => {
    setCap(v);
    try { if (v.trim()) localStorage.setItem(CAP_KEY(projectId), v); else localStorage.removeItem(CAP_KEY(projectId)); } catch { /* ignore */ }
  };

  if (!loaded) return null;

  return (
    <div className="cinema-card !p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="cinema-eyebrow flex items-center gap-1.5">
          <CurrencyCny size={13} className="text-[var(--cinema-amber)]" /> 成本归因 · 这一单花在哪
        </div>
        {attr && attr.totalCny > 0 && (
          <span className="cinema-mono text-[13px] tabular-nums">¥{attr.totalCny.toFixed(2)}</span>
        )}
      </div>

      {!attr || attr.totalCny === 0 ? (
        <EmptyState icon={CurrencyCny} title="暂无成本数据" hint="生成成片后即可看每阶段花销与省钱建议" />
      ) : (
        <>
          {/* v9.7.17 预算护栏 */}
          <div className="mb-3 rounded border border-[var(--cinema-border)] bg-[var(--cinema-surface-2)] p-2.5">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="cinema-mono text-[11px] text-[var(--cinema-text-3)]">预算上限 ¥</span>
              <input
                type="number" min="0" inputMode="decimal" value={cap}
                onChange={(e) => onCapChange(e.target.value)} placeholder="未设"
                className="cinema-input !w-20 !py-0.5 !text-[11px] text-right"
              />
            </div>
            {guard.level !== 'none' && (
              <>
                <div className="h-1.5 rounded bg-[var(--cinema-border)] overflow-hidden">
                  <div className={`h-full rounded ${GUARD_BAR[guard.level]}`} style={{ width: `${Math.min(100, guard.pctUsed || 0)}%` }} />
                </div>
                <div className={`cinema-mono text-[11px] mt-1 ${GUARD_CLS[guard.level]}`}>{guard.message}</div>
              </>
            )}
          </div>

          {/* 各类目占比条 */}
          <div className="space-y-2 mb-3">
            {attr.byCategory.map((c) => (
              <div key={c.category} className="flex items-center gap-2.5">
                <span className="cinema-mono text-[11px] text-[var(--cinema-text-2)] w-20 shrink-0 truncate">{c.label}</span>
                <div className="flex-1 min-w-0 h-1.5 rounded bg-[var(--cinema-border)] overflow-hidden">
                  <div className="h-full rounded" style={{ width: `${Math.max(2, c.pct)}%`, backgroundColor: CAT_COLOR[c.category] }} />
                </div>
                <span className="cinema-mono text-[11px] text-[var(--cinema-text-3)] w-10 shrink-0 text-right tabular-nums">{c.pct}%</span>
                <span className="cinema-mono text-[11px] text-[var(--cinema-text-2)] w-14 shrink-0 text-right tabular-nums">¥{c.costCny.toFixed(2)}</span>
              </div>
            ))}
          </div>

          {/* 省钱提示 */}
          <div className="space-y-1">
            {attr.hints.map((h, i) => (
              <div key={i} className="cinema-mono text-[11px] text-[var(--cinema-text-3)] flex gap-1.5 leading-relaxed">
                <Lightbulb size={12} weight="fill" className="text-[var(--cinema-amber)] shrink-0 mt-0.5" />{h}
              </div>
            ))}
          </div>

          {/* v12.224 COGS / 毛利下钻(投资人视角:逐引擎单价×用量 + 参考售价算毛利) */}
          <div className="mt-3 pt-3 border-t border-[var(--cinema-border)]">
            <button
              onClick={() => { const next = !showCogs; setShowCogs(next); if (next && !cogs) void loadCogs(sale); }}
              className="cinema-mono text-[11px] text-[var(--cinema-text-2)] hover:text-[var(--cinema-amber)] flex items-center gap-1.5"
            >
              📊 COGS 报告 · 单片销货成本与毛利 {showCogs ? '▾' : '▸'}
            </button>
            {showCogs && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="cinema-mono text-[11px] text-[var(--cinema-text-3)]">参考售价 ¥</span>
                  <input
                    type="number" min="0" inputMode="decimal" value={sale}
                    onChange={(e) => setSale(e.target.value)} onBlur={() => void loadCogs(sale)}
                    placeholder="填单片售价算毛利" className="cinema-input !w-28 !py-0.5 !text-[11px] text-right"
                  />
                </div>
                {cogs && (
                  <>
                    <div className="space-y-1.5">
                      {cogs.lines.map((l) => (
                        <div key={l.engine} className="flex items-center gap-2 cinema-mono text-[11px]">
                          <span className="w-24 shrink-0 truncate text-[var(--cinema-text-2)]" title={l.engine}>{l.engine}</span>
                          <span className="text-[var(--cinema-text-3)] w-28 shrink-0">
                            ¥{l.unitRateCny}/{l.unit === 'per_sec' ? '秒' : '次'} × {l.unit === 'per_sec' ? `${l.totalSec}s` : `${l.count}次`}
                          </span>
                          <div className="flex-1 min-w-0 h-1.5 rounded bg-[var(--cinema-border)] overflow-hidden">
                            <div className="h-full rounded bg-[var(--cinema-amber)]" style={{ width: `${Math.max(2, l.pct)}%` }} />
                          </div>
                          <span className="w-14 shrink-0 text-right tabular-nums text-[var(--cinema-text-2)]">¥{l.subtotalCny.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between cinema-mono text-[11px] pt-1.5 border-t border-[var(--cinema-border)]">
                      <span className="text-[var(--cinema-text-2)]">总 COGS</span>
                      <span className="tabular-nums text-[var(--cinema-text-1)]">¥{cogs.totalCogsCny.toFixed(2)}</span>
                    </div>
                    {cogs.margin && (
                      <div className={`cinema-mono text-[11px] rounded p-2 ${cogs.margin.grossProfitCny >= 0 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'}`}>
                        售价 ¥{cogs.margin.saleCny.toFixed(2)} − COGS ¥{cogs.margin.cogsCny.toFixed(2)} = 毛利 ¥{cogs.margin.grossProfitCny.toFixed(2)}
                        <span className="opacity-80"> · 毛利率 {cogs.margin.grossMarginPct}%</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
