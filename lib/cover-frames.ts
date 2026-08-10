/**
 * 成片抽帧封面精选(v12.113.0)。
 *
 * 病根:封面走 T2I 另出图(费额度,且与成片观感可能脱节)。平台数据上「封面=成片高光帧」
 * 点击-完播一致性更好。本模块从 final_video 均匀抽帧 → 复用 shot-quality-gate 的 VLM 打分
 * (质量为主;字幕本来就烧在片里,烤字只轻罚)→ 排序供选/直接定版。
 * 纯函数(采样点/排序)可单测;抽帧与打分在 route 层。
 */

/** 采样时间点:避开片头 hook 卡与片尾 CTA 卡,取 12%–80% 均匀分布(0.1s 精度)。 */
export function pickFrameTimes(durationSec: number, n: number = 4): number[] {
  if (!durationSec || durationSec <= 0) return [];
  const count = Math.max(1, Math.min(Math.floor(n), 8));
  const start = durationSec * 0.12;
  const end = durationSec * 0.8;
  if (end <= start || count === 1) return [Math.round((durationSec / 2) * 10) / 10];
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round((start + step * i) * 10) / 10);
}

export interface CoverFrameScore {
  url: string;          // /api/serve-file?path=... 供前端/choose 直接用
  timeSec: number;
  quality: number;      // VLM 质量分(0-100,同 shot-quality-gate);打分失败 = 0
  hasBakedText: boolean;
  scored: boolean;      // false = VLM 全挂(排最后但保留,人工可选)
}

/** 排序:质量降序;烧字轻罚 1 分(成片帧带字幕是常态,不一票否决);未打分垫底。 */
export function rankCoverFrames(frames: CoverFrameScore[]): CoverFrameScore[] {
  const val = (f: CoverFrameScore) => (f.scored ? f.quality - (f.hasBakedText ? 1 : 0) : -1);
  return [...frames].sort((a, b) => val(b) - val(a));
}
