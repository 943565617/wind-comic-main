'use client';

/**
 * DecisionLogPanel (v12.199) — 逐镜可审计决策日志入口。
 *
 * 病根:GET /api/projects/:id/decision-log(v12.37 已实现:逐镜引擎/成本/一致性分 + 项目质量分)
 * 前端从无任何组件调用,能力等于未交付。本面板给「技术监看」台一个折叠入口,
 * 拉决策日志展示逐镜表(镜号 / 出片引擎 / 成本 / 一致性分),给导演/甲方一份可复查的账。
 * 需登录(cookie 自动带);无数据 → 静默空态,不打扰。
 */

import { useState } from 'react';

interface ShotDecision {
  shotNumber: number;
  videoEngine?: string;
  costCny: number;
  engines: string[];
  consistencyScore?: number;
}
interface DecisionLogResp {
  ok?: boolean;
  shots?: ShotDecision[];
  totals?: { totalCostCny: number; shotCount: number };
  quality?: { overall?: number } | null;
}

export function DecisionLogPanel({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<DecisionLogResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/decision-log`);
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || '加载失败');
      setData(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const shots = data?.shots || [];

  return (
    <div className="cinema-card p-3">
      <button
        type="button"
        onClick={() => { const o = !open; setOpen(o); if (o && !data) void load(); }}
        className="cinema-btn-ghost !text-[11px] !py-1 w-full text-left"
      >
        🧾 决策日志(逐镜引擎/成本/一致性)
        {data?.totals ? `(${data.totals.shotCount} 镜 · ¥${data.totals.totalCostCny})` : ''}
        {open ? ' ▲' : ' ▼'}
      </button>
      {open && loading && <div className="mt-2 cinema-mono text-[10px] opacity-60">查询中…</div>}
      {open && err && <div className="mt-2 cinema-mono text-[10px] text-[var(--cinema-red)]">{err}</div>}
      {open && !loading && !err && shots.length === 0 && (
        <div className="mt-2 cinema-mono text-[10px] opacity-60">暂无逐镜决策数据(生成成片后自动积累)。</div>
      )}
      {open && shots.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[11px] cinema-mono">
            <thead>
              <tr className="opacity-55 text-left">
                <th className="py-1 pr-3">镜</th>
                <th className="py-1 pr-3">出片引擎</th>
                <th className="py-1 pr-3">成本</th>
                <th className="py-1">一致性</th>
              </tr>
            </thead>
            <tbody>
              {shots.map((s) => (
                <tr key={s.shotNumber} className="border-t border-white/10">
                  <td className="py-1 pr-3">S{s.shotNumber}</td>
                  <td className="py-1 pr-3">{s.videoEngine || s.engines.join('/') || '—'}</td>
                  <td className="py-1 pr-3">¥{s.costCny}</td>
                  <td className="py-1">{typeof s.consistencyScore === 'number' ? s.consistencyScore : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {typeof data?.quality?.overall === 'number' && (
            <div className="mt-2 text-[10px] opacity-70">项目质量分:{data.quality.overall}</div>
          )}
        </div>
      )}
    </div>
  );
}
