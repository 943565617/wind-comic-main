'use client';

/**
 * 引擎天气条(v12.149.0)—— 创作前让用户知道哪路引擎不健康,而不是开机后黑箱降级。
 *
 * 数据源 /api/api-status(v2.17 就有,但此前前端零消费):
 *   - alerts:DB 告警(minimax/midjourney/veo 埋点,1h 窗口)
 *   - gateways:内存网关破产快照(qingyuntop/vectorengine 配额冷却期)
 * 全健康 → 不渲染(零占位);有事 → 一行琥珀色横条,可手动刷新。
 */
import { useEffect, useState, useCallback } from 'react';

interface Alert { provider: string; alertType: string; lastSeenAt: string; count: number }
interface Gateway { host: string; remainingSec: number }

const PROVIDER_LABEL: Record<string, string> = {
  minimax: 'MiniMax(视频/图)', veo: 'Veo(视频)', midjourney: 'Midjourney(图)', kling: '可灵(视频)',
};
const TYPE_LABEL: Record<string, string> = {
  exhausted: '余额/额度耗尽', auth_failed: '密钥失效', saturated: '上游饱和', rate_limited: '限流中',
};

/** 纯函数:状态 → 展示片段(可单测)。v12.161:引擎近10分钟失败 ≥3 也亮条。
 *  v12.216:+能力边界提示(如「Kling 原生音效不可用」)—— 运营者开了不生效的开关时上下文亮条。 */
export function weatherSegments(
  alerts: Alert[],
  gateways: Gateway[],
  engines: Array<{ provider: string; recentFailures: number }> = [],
  capabilityNotes: Array<{ text: string }> = [],
): string[] {
  const segs: string[] = [];
  for (const a of alerts) {
    segs.push(`${PROVIDER_LABEL[a.provider] || a.provider} ${TYPE_LABEL[a.alertType] || a.alertType}`);
  }
  for (const g of gateways) {
    segs.push(`网关 ${g.host} 配额冷却(约 ${Math.max(1, Math.round(g.remainingSec / 60))} 分钟)`);
  }
  for (const e of engines) {
    if (e.recentFailures >= 3) segs.push(`${PROVIDER_LABEL[e.provider] || e.provider} 近10分钟失败 ${e.recentFailures} 次(不稳)`);
  }
  for (const n of capabilityNotes) {
    segs.push(`⚙️ ${n.text}`);
  }
  return segs;
}

export function EngineWeather() {
  const [segs, setSegs] = useState<string[]>([]);
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/api-status');
      const data = await res.json();
      setSegs(weatherSegments(data.alerts || [], data.gateways || [], data.engines || [], data.capabilityNotes || []));
    } catch { /* 拉不到就当晴天,不打扰 */ }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 120_000);
    return () => clearInterval(t);
  }, [load]);

  if (segs.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200/90 flex items-start gap-2" data-testid="engine-weather">
      <span className="shrink-0">🌩️</span>
      <div className="min-w-0">
        <span className="opacity-70">引擎天气:</span>{segs.join(' · ')}
        <span className="opacity-50"> —— 受影响链路会自动降级/换引擎,可先创作或稍后重试</span>
      </div>
      <button type="button" onClick={() => void load()} className="ml-auto shrink-0 opacity-60 hover:opacity-100" title="刷新">↻</button>
    </div>
  );
}
