/**
 * lib/mv-plan — MV(音乐视频)模式的镜头规划(v12.246)。
 *
 * ## 为什么单独一个模式
 *
 * 现有全部创作模式(剧集/短视频/广告/长篇)都是**剧本驱动**:先有故事 → 拆镜 → 每镜配时长。
 * MV 是唯一**音乐驱动**的:先有一首曲子和它的节拍,画面切点必须**卡在拍子上**,
 * 段落(主歌/副歌)的节奏差异直接决定剪辑密度 —— 副歌切得快、主歌舒展。
 * 这条主轴和剧本驱动正交,所以值得独立成模式(竞品升级矩阵 C 列的 MV 项,此前 ❌)。
 *
 * ## 本模块只管「算镜头时间轴」
 *
 * 纯函数,零 I/O:给定音乐时长 + BPM(+ 可选段落),算出每镜的起止秒,保证**每个切点落在拍上**、
 * 副歌自动加密、总时长贴合音乐。视觉画面生成、BGM 生成/上传、出片合成复用既有管线,不在这里。
 *
 * BPM 从哪来:生成 BGM 时可指定;上传音乐则由用户填(自动 BPM 检测需音频分析,较重,留待后续,
 * 现在如实要求显式传入)。
 */

export type MvSectionKind = 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro';

export interface MvSection {
  kind: MvSectionKind;
  startSec: number;
  endSec: number;
}

export interface MvPlanInput {
  /** 音乐总时长(秒),> 0。 */
  musicDurationSec: number;
  /** 每分钟拍数,常见 60~200;<= 0 视为非法。 */
  bpm: number;
  /** 每镜默认占几拍(默认 8 = 4/4 拍的两小节)。副歌会自动减半。 */
  beatsPerShot?: number;
  /** 第一拍相对 0 秒的偏移(前奏留白),默认 0。 */
  phaseSec?: number;
  /** 可选段落表 —— 提供后 chorus 段按 beatsPerShot/2 加密切镜。 */
  sections?: MvSection[];
  /** 单镜最短时长(秒),防止高 BPM 下切得太碎导致引擎无法生成,默认 1.0。 */
  minShotSec?: number;
}

export interface MvShot {
  index: number;         // 从 1 起
  startSec: number;
  endSec: number;
  durationSec: number;
  section: MvSectionKind | 'unknown';
  onBeat: true;          // 本模块产出的切点必然对齐拍(命名即契约)
}

const DEFAULT_BEATS_PER_SHOT = 8;
const DEFAULT_MIN_SHOT_SEC = 1.0;

/** 某个时间点落在哪个段落。无段落表 → 'unknown'。 */
export function sectionAt(sections: MvSection[] | undefined, t: number): MvSectionKind | 'unknown' {
  if (!sections?.length) return 'unknown';
  for (const s of sections) {
    if (t >= s.startSec && t < s.endSec) return s.kind;
  }
  return 'unknown';
}

/**
 * 规划 MV 镜头时间轴:按拍切镜,副歌加密,末镜贴合音乐结尾。
 *
 * 返回的每一镜 startSec/endSec 都落在拍网格上(末镜 endSec 例外 —— 它夹到音乐总时长,
 * 保证画面不超出音乐);相邻镜首尾相接、无空档无重叠。非法输入(时长/ BPM ≤ 0)返回 []。
 */
export function planMvShots(input: MvPlanInput): MvShot[] {
  const { musicDurationSec, bpm } = input;
  if (!(musicDurationSec > 0) || !(bpm > 0)) return [];

  const beatSec = 60 / bpm;
  const baseBeats = Math.max(1, Math.round(input.beatsPerShot ?? DEFAULT_BEATS_PER_SHOT));
  const phase = Math.max(0, input.phaseSec ?? 0);
  const minShot = Math.max(0.1, input.minShotSec ?? DEFAULT_MIN_SHOT_SEC);
  const sections = input.sections;

  const shots: MvShot[] = [];
  let cursor = phase;
  let idx = 1;
  // 上限保护:再密也不至于无限循环(每镜至少 minShot,总数封顶)
  const hardCap = Math.ceil(musicDurationSec / minShot) + 2;

  while (cursor < musicDurationSec - 1e-6 && shots.length < hardCap) {
    const sec = sectionAt(sections, cursor);
    // 副歌加密:每镜拍数减半(向上取整,至少 1 拍),切点更快 → 情绪更强
    const beats = sec === 'chorus' ? Math.max(1, Math.ceil(baseBeats / 2)) : baseBeats;
    let end = cursor + beats * beatSec;

    // 末镜:若剩余不足一个完整镜,或超出音乐,夹到音乐结尾
    if (end > musicDurationSec) end = musicDurationSec;

    // 尾巴过短 → 并入上一镜(避免出现 0.3s 的碎镜);没有上一镜就保留(整曲极短)
    if (end - cursor < minShot && shots.length > 0) {
      const prev = shots[shots.length - 1];
      prev.endSec = end;
      prev.durationSec = round2(prev.endSec - prev.startSec);
      break;
    }

    shots.push({
      index: idx++,
      startSec: round2(cursor),
      endSec: round2(end),
      durationSec: round2(end - cursor),
      section: sec,
      onBeat: true,
    });
    cursor = end;
  }
  return shots;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 给 UI/日志用的一句话摘要。 */
export function summarizeMvPlan(shots: MvShot[]): string {
  if (!shots.length) return '空(音乐时长或 BPM 非法)';
  const total = shots[shots.length - 1].endSec;
  const chorus = shots.filter((s) => s.section === 'chorus').length;
  return `${shots.length} 镜 / ${total}s${chorus ? ` · 副歌加密 ${chorus} 镜` : ''}`;
}
