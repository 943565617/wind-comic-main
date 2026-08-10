/**
 * Kling v3 多镜合并(v12.176.0,KLING_MULTISHOT=1 opt-in,默认关)。
 *
 * 官方 3.0 宣传单次 prompt 定义多镜(空间连续性模型级保持);独立 body 字段零成本探测
 * 不可证实(未知字段被静默忽略)→ 采用**有据可依的 prompt 语法形态**:
 * 把 transition==='continuous' 且同场景的相邻镜分组(≤3 镜、总时长 ≤15s),
 * 一次 v3 15s 调用产整段;组内非首镜标 mergedInto,composer 拼接时跳过(时长已含)。
 * 纯函数可单测;真替代收益(成本 -N 次调用 + 免拼接痕)由 A/B 实测定去留。
 */

export interface MergeableShot {
  shotNumber: number;
  duration?: number;
  transition?: string;
  sceneDescription?: string;
  visualPrompt?: string;
}

export interface ShotGroup {
  shots: MergeableShot[];
  totalSec: number;
}

const sameScene = (a?: string, b?: string): boolean => {
  const x = (a || '').slice(0, 30), y = (b || '').slice(0, 30);
  return !!x && !!y && (x === y || x.includes(y.slice(0, 15)) || y.includes(x.slice(0, 15)));
};

/** 连续镜分组:相邻 continuous+同场景合并,约束 ≤maxGroup 镜 / ≤maxSec 秒;其余单镜成组。 */
export function groupContinuousShots(
  shots: MergeableShot[],
  opts: { maxGroup?: number; maxSec?: number } = {},
): ShotGroup[] {
  const maxGroup = opts.maxGroup ?? 3;
  const maxSec = opts.maxSec ?? 15;
  const groups: ShotGroup[] = [];
  for (const s of shots) {
    const sec = Math.max(2, s.duration ?? 5);
    const last = groups[groups.length - 1];
    const joinable = last
      && s.transition === 'continuous'
      && last.shots.length < maxGroup
      && last.totalSec + sec <= maxSec
      && sameScene(last.shots[last.shots.length - 1].sceneDescription, s.sceneDescription);
    if (joinable) { last.shots.push(s); last.totalSec += sec; }
    else groups.push({ shots: [s], totalSec: sec });
  }
  return groups;
}

/** 组 → 编号多镜 prompt(Kling 3.0 官宣语法形态:Shot N 段落 + 时长标注)。 */
export function buildMultiShotPrompt(group: ShotGroup): string {
  if (group.shots.length === 1) return group.shots[0].visualPrompt || group.shots[0].sceneDescription || '';
  const parts = group.shots.map((s, i) =>
    `Shot ${i + 1} (~${Math.max(2, s.duration ?? 5)}s): ${s.visualPrompt || s.sceneDescription || ''}`.trim());
  return `A continuous ${group.totalSec}s sequence in one location, seamless camera flow between shots.\n${parts.join('\n')}`;
}
