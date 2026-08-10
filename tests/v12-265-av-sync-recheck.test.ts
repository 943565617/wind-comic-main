/**
 * v12.265 — v12.264 音画同步修复的**对抗复检补漏**。
 *
 * 复检抓到 v12.264 只修了三处纯累加里的两处:
 *  ① 打击音效(impact SFX)另有**独立的第二处** `cum2 += durations[k]*1000` —— 闷响仍在未压缩
 *     时间轴上,与配音同根同量地晚 Σ effectiveTd(动作片"打完才响")。
 *  ② SRT 展示时长改用「到下一镜起点的 gap」后,isLastCut 分支的 effectiveTd 硬写 0.1(绕过 /2 夹取),
 *     极短镜下 gap 可能为 0 → 落进 buildSrtWithStarts「非法→5s」兜底 → 5 秒错字幕压住下一条。
 *  ③ 画面 offset 与音轨/字幕起点当时仍是**两处独立递推**(数值恰好相等)→ 将来各改各的会无声错位,
 *     正是本 bug 的成因模式。v12.265 把 offset 也改取 clipStartSec,四轨结构性同源。
 */
import { describe, it, expect } from 'vitest';
import { computeXfadeTimeline } from '@/services/video-composer';
import { buildSrtWithStarts } from '@/lib/text-control';
import fs from 'fs';

const SRC = fs.readFileSync('services/video-composer.ts', 'utf-8');

describe('v12.265 · ① 打击音效起点同源(复检 HIGH)', () => {
  it('SFX 起点取 clipStartMs,不再独立纯累加 cum2', () => {
    expect(SRC).toContain('startMs2.set(sn, clipStartMs[k] || 0)');
    expect(SRC).not.toContain('cum2 += (durations[k] || 0) * 1000');
    expect(SRC).not.toMatch(/let cum2 = 0/);
  });

  it('回归量化:4 镜 × 0.5s 转场,末镜 SFX 旧版比画面晚 1.5s', () => {
    const durations = [4, 4, 4, 4];
    const effectiveTds = [0, 0.5, 0.5, 0.5];
    const { clipStartSec } = computeXfadeTimeline(durations, effectiveTds);
    const oldPlainCumsum = [0, 4, 8, 12];
    // 末镜:旧版 12s 起,真实画面 10.5s 起 → 闷响晚 1.5s(拳头早落地了才响)
    expect(clipStartSec[3]).toBeCloseTo(10.5, 6);
    expect(oldPlainCumsum[3] - clipStartSec[3]).toBeCloseTo(1.5, 6);
  });
});

describe('v12.265 · ② 字幕 gap 退化保护(复检 LOW,v12.264 引入)', () => {
  it('极短镜被转场吞没时 gap=0 —— 调用方退回该镜自身时长,不放大成 5s', () => {
    // durations=[3, 0.1, 5],第 3 镜经 cut 进入(effectiveTd 硬写 0.1)
    const { clipStartSec } = computeXfadeTimeline([3, 0.1, 5], [0, 0, 0.1]);
    expect(clipStartSec).toEqual([0, 3, 3]); // 第 2 镜起点 == 第 3 镜起点 → gap 为 0
    const gap = clipStartSec[2] - clipStartSec[1];
    expect(gap).toBe(0);
    // 若把 0 直接传进去,会触发「非法→5s」兜底(这正是要避免的)
    expect(buildSrtWithStarts([{ dialogue: 'X', startSec: 3, durSec: 0 }])).toContain('00:00:03,000 --> 00:00:08,000');
    // 调用方已守:gap 不为正 → 退回该镜自身时长 0.1s
    expect(SRC).toContain('durSec: gap > 0 ? gap : durations[k]');
  });
});

describe('v12.265 · ③ 四轨结构性同源(消除双递推漂移风险)', () => {
  it('画面 xfade offset 直接取 clipStartSec[i],不再内联独立递推', () => {
    expect(SRC).toContain('offset=${clipStartSec[i].toFixed(2)}');
    // 旧的内联递推两行必须消失
    expect(SRC).not.toContain('const offset = Math.max(0, cumulativeDuration - effectiveTd)');
    expect(SRC).not.toContain('cumulativeDuration = offset + durations[i]');
  });

  it('总时长取 computeXfadeTimeline 的 totalSec(BGM 尾淡出/totalDuration 同源)', () => {
    expect(SRC).toContain('const cumulativeDuration = totalSec');
    const { totalSec } = computeXfadeTimeline([4, 4, 4, 4], [0, 0.5, 0.5, 0.5]);
    expect(totalSec).toBeCloseTo(14.5, 6); // 16 − 1.5
  });

  it('四条消费线全部落在 clipStartSec/clipStartMs 上(画面/配音/字幕/打击音效)', () => {
    expect(SRC).toContain('offset=${clipStartSec[i].toFixed(2)}');   // 画面
    expect(SRC).toContain('shotStartMs.set(sn, clipStartMs[k] || 0)'); // 配音
    expect(SRC).toContain('startSec: clipStartSec[k]');                // 字幕
    expect(SRC).toContain('startMs2.set(sn, clipStartMs[k] || 0)');    // 打击音效
  });
});
