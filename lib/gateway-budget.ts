/**
 * 网关配额感知(v12.127.0)—— 成本/余额感知路由的地基。
 *
 * 病根:qingyuntop 网关配额耗尽($0)后,一条片子的几十次 LLM/图像/视频调用**每次都先白撞**那个
 * 已破产的网关(403 quota,1-5s/次 × N),再落兜底。llm-health(v12.61)只对 429/503/超时冷却 90s,
 * 而「配额耗尽」不是瞬时错误、90s 更不会恢复(要充值或次日刷新)。本模块单独记账:某网关一旦回过
 * 「配额耗尽/欠费」类错误,进程内 TTL 冷却期(默认 10min)直接跳过,省掉成片全程的重复 403 往返。
 *
 * 纯逻辑(注入 now 可测)。按网关 host 归并(同网关的 LLM/图像/视频共用一个破产信号)。
 */

const outOfCreditsUntil = new Map<string, number>();
// 10min:配额耗尽不会秒恢复(需充值/次日刷新),但也别永久钉死 —— 充值后随 TTL 自愈,不必重启进程。
const DEFAULT_OOC_TTL_MS = 10 * 60_000;

/** 从 baseURL / 完整 URL 取网关 host(归并同网关的不同路径/模型)。取不到则返回原串。 */
export function gatewayHost(url: string | undefined | null): string {
  if (!url) return '';
  try { return new URL(url).host; } catch { /* 非完整 URL */ }
  const m = String(url).match(/^https?:\/\/([^/]+)/i);
  return m ? m[1] : String(url);
}

/** 配额耗尽/欠费类错误判定(纯函数):区别于瞬时 429/503。 */
export function isOutOfCreditsError(msg: string | undefined | null): boolean {
  if (!msg) return false;
  const s = String(msg).toLowerCase();
  // 402 欠费、403 配额、以及各网关的文案(qingyuntop "token quota is not enough / exhausted"、"insufficient" 等)
  if (/\b402\b|\b403\b/.test(s) && /quota|credit|balance|insufficient|欠费|余额|配额/.test(s)) return true;
  // v12.177:qingyuntop 实测文案「该令牌额度已用尽」此前不匹配 → 网关破产不进冷却、天气条不亮
  return /quota (is not enough|exhausted|exceeded)|insufficient (quota|credit|balance)|out of credit|token quota|余额不足|配额(耗尽|不足)|欠费|额度已用尽|令牌额度/.test(s);
}

/** 标记某网关配额耗尽(TTL 内跳过)。 */
export function markGatewayOutOfCredits(url: string, ttlMs: number = DEFAULT_OOC_TTL_MS, now: number = Date.now()): void {
  const host = gatewayHost(url);
  if (host) outOfCreditsUntil.set(host, now + Math.max(1000, ttlMs));
}

/** 某网关当前是否处于配额耗尽冷却期(到期自动清)。 */
export function isGatewayOutOfCredits(url: string | undefined | null, now: number = Date.now()): boolean {
  const host = gatewayHost(url);
  if (!host) return false;
  const t = outOfCreditsUntil.get(host);
  if (t == null) return false;
  if (t <= now) { outOfCreditsUntil.delete(host); return false; }
  return true;
}

/**
 * 过滤掉已破产网关的尝试(纯逻辑,注入 now)。绝不返回空:全破产 → 保留原链最后一个作最后一搏
 * (宁可慢/仍失败,也别直接不生成 —— 与 llm-health.filterHealthyAttempts 同哲学)。
 */
export function filterFundedAttempts<T extends { baseURL?: string }>(attempts: T[], now: number = Date.now()): T[] {
  if (attempts.length <= 1) return attempts;
  const funded = attempts.filter((a) => !isGatewayOutOfCredits(a.baseURL, now));
  return funded.length > 0 ? funded : [attempts[attempts.length - 1]];
}

/** 测试用:清空配额缓存。 */
/** v12.149(引擎天气面板):当前处于配额耗尽冷却期的网关快照(host + 剩余秒)。 */
export function listOutOfCreditsGateways(now: number = Date.now()): Array<{ host: string; remainingSec: number }> {
  const out: Array<{ host: string; remainingSec: number }> = [];
  for (const [host, until] of outOfCreditsUntil) {
    if (until > now) out.push({ host, remainingSec: Math.round((until - now) / 1000) });
  }
  return out;
}

export function _resetGatewayBudget(): void {
  outOfCreditsUntil.clear();
}
