/**
 * 缺失/降级镜自愈识别(v12.125.0)。
 *
 * 病根:成片有缺失镜(供给翻车,missing-video)/ 兜底镜(kenburns/broll)/ 烤字镜(video-baked-text)时,
 * quality_report 只如实记账,补救全靠人工翻日志+逐镜重生。本模块从质检报告识别「可自愈镜」,
 * 供 `/heal-shots` 端点在供给恢复后一键补拍 → 重合成。纯逻辑(识别/排序/优先级)可单测。
 *
 * 可自愈类:missing-video(最急,内容直接没了)> video-baked-text(画面带烤字,重生求干净)
 *          > kenburns-fallback(静图动画,重生求真动态)> broll-fallback(实拍兜底,重生求 AI 定制)。
 */

export type HealReason = 'missing-video' | 'video-baked-text' | 'kenburns-fallback' | 'broll-fallback';

export const HEALABLE_KINDS: readonly string[] = ['missing-video', 'video-baked-text', 'kenburns-fallback', 'broll-fallback'];

export interface HealableShot {
  shot: number;
  reasons: string[];       // 该镜命中的全部事件类
  healable: string[];      // 其中可自愈的类(HEALABLE_KINDS ∩ reasons)
  hasStoryboard: boolean;  // 有分镜图 → 可 I2V 首帧锚定补拍;无 → 只能 T2V(质量次之)
  priority: number;        // 4 缺失 > 3 烤字 > 2 静图兜底 > 1 实拍兜底
}

/** 纯函数:某镜可自愈类的最高优先级(缺失最急)。 */
export function healPriority(kinds: string[]): number {
  if (kinds.includes('missing-video')) return 4;
  if (kinds.includes('video-baked-text')) return 3;
  if (kinds.includes('kenburns-fallback')) return 2;
  if (kinds.includes('broll-fallback')) return 1;
  return 0;
}

/**
 * 从质检报告识别可自愈镜。优先用 v12.125+ 的 `shotReasons`(精准 shot→kind);
 * 旧报告(仅 degradedShots)降级:degradedShots 视为可自愈(reason='degraded',无细分)。
 * @param storyboardShots 有分镜图的镜号列表(决定 I2V/T2V 与是否值得补)。
 */
export function identifyHealableShots(
  report: { shotReasons?: Record<number, string[]>; degradedShots?: number[] } | null | undefined,
  storyboardShots: number[] = [],
): HealableShot[] {
  if (!report) return [];
  const sbSet = new Set(storyboardShots);
  const out: HealableShot[] = [];
  const shotReasons = report.shotReasons || {};

  if (Object.keys(shotReasons).length > 0) {
    for (const [shotStr, reasons] of Object.entries(shotReasons)) {
      const shot = Number(shotStr);
      if (!(shot > 0)) continue;
      const healable = (reasons || []).filter((k) => HEALABLE_KINDS.includes(k));
      if (healable.length === 0) continue;
      out.push({ shot, reasons, healable, hasStoryboard: sbSet.has(shot), priority: healPriority(healable) });
    }
  } else if (report.degradedShots?.length) {
    // 旧报告兜底:只知哪些镜降级,不知具体类
    for (const shot of report.degradedShots) {
      if (!(shot > 0)) continue;
      out.push({ shot, reasons: ['degraded'], healable: ['degraded'], hasStoryboard: sbSet.has(shot), priority: 2 });
    }
  }

  out.sort((a, b) => b.priority - a.priority || a.shot - b.shot);
  return out;
}

// ─── v12.138 资产行字段兼容(live 抓获的真 bug)─────────────────────────────────
// listAssetsByType 返回**蛇形**原始行(shot_number / persistent_url / media_urls 为 JSON 字符串),
// 而多个调用点误用驼峰(shotNumber/persistentUrl/mediaUrls)→ 全 undefined:草图锁取不到草图、
// heal-shots 的 hasStoryboard 恒 false。这两个纯函数兼容两种形态,所有资产行读取统一走它们。

/** 资产行镜号(蛇形/驼峰兼容)。 */
export function assetShotNumber(row: any): number | null {
  const n = row?.shot_number ?? row?.shotNumber;
  return Number.isInteger(n) ? n : (typeof n === 'number' ? n : null);
}

/** 资产行首个可用媒体 URL:persistent_url 优先(CDN 过期问题),否则 media_urls JSON 首个。 */
export function assetFirstMediaUrl(row: any): string | null {
  const p = row?.persistent_url ?? row?.persistentUrl;
  if (typeof p === 'string' && p) return p;
  const m = row?.media_urls ?? row?.mediaUrls;
  if (Array.isArray(m)) return m[0] || null;
  if (typeof m === 'string') { try { const a = JSON.parse(m); return Array.isArray(a) ? (a[0] || null) : null; } catch { return null; } }
  return null;
}
