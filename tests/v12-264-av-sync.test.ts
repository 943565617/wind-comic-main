/**
 * v12.264 — 音画同步根因修复(真机实测 0.5~1s 配音/字幕滞后)。
 *
 * 根因:链式 xfade 每次转场把**画面**时间轴压缩 effectiveTd(offset = 累计时长 − effectiveTd),
 *       而配音 adelay / SRT 字幕都按 durations[] **纯累加**定位(不减转场重叠)→ 相对压缩后画面
 *       逐镜滞后 Σ effectiveTd(默认转场 0.5s × 转场数 ≈ 0.5~1s,与用户真机观感吻合)。
 * 修复:画面 xfade offset、配音起点、字幕起点三者都由 computeXfadeTimeline 同一递推产出 → 同源齐平。
 *
 * 本套件锁「压缩时间轴」纯函数的**真实行为**(composer 逐字节复用它算 clipStartMs / 字幕起点),
 * 而非 grep 源码字符串。
 */
import { describe, it, expect } from 'vitest';
import { computeXfadeTimeline } from '@/services/video-composer';
import { buildSrt, buildSrtWithStarts } from '@/lib/text-control';
import fs from 'fs';

describe('v12.264 · computeXfadeTimeline(xfade 压缩后画面起点)', () => {
  it('每镜起点 = 累计时长 − Σ effectiveTd(而非纯累加)', () => {
    const durations = [3, 4, 5];
    const effectiveTds = [0, 0.5, 0.6]; // [0] 恒 0(首镜无转场)
    const { clipStartSec, totalSec } = computeXfadeTimeline(durations, effectiveTds);
    // 首镜从 0 起;第 2 镜 = 3 − 0.5 = 2.5;第 3 镜 = (2.5+4) − 0.6 = 5.9
    expect(clipStartSec).toEqual([0, 2.5, 5.9]);
    expect(totalSec).toBeCloseTo(10.9, 6); // 5.9 + 5
  });

  it('这就是那 0.5~1s:与旧版「durations 纯累加」的差 == Σ effectiveTd(逐镜累积)', () => {
    const durations = [3, 4, 5];
    const effectiveTds = [0, 0.5, 0.6];
    const { clipStartSec } = computeXfadeTimeline(durations, effectiveTds);
    // 旧版(错):配音/字幕起点 = durations 纯累加
    const oldPlainCumsum = [0, 3, 7];
    const drift = oldPlainCumsum.map((v, i) => v - clipStartSec[i]);
    // 漂移逐镜累积:0 → 0.5 → 1.1(= Σ effectiveTd),正是真机 0.5~1s 滞后来源
    expect(drift[0]).toBeCloseTo(0, 6);
    expect(drift[1]).toBeCloseTo(0.5, 6);
    expect(drift[2]).toBeCloseTo(1.1, 6);
  });

  it('offset 永不为负:转场时长超过前镜可用时长时 clamp 到 0', () => {
    const { clipStartSec, totalSec } = computeXfadeTimeline([1, 5], [0, 3]);
    expect(clipStartSec).toEqual([0, 0]); // max(0, 1−3) = 0
    expect(totalSec).toBeCloseTo(5, 6); // 0 + 5
  });

  it('单镜 / 空数组不炸:单镜起点=[0],空=[]', () => {
    expect(computeXfadeTimeline([4], [0])).toEqual({ clipStartSec: [0], totalSec: 4 });
    expect(computeXfadeTimeline([], [])).toEqual({ clipStartSec: [], totalSec: 0 });
  });

  it('缺省 effectiveTd 视作 0(纯硬切退化为普通累加)', () => {
    const { clipStartSec, totalSec } = computeXfadeTimeline([2, 2, 2], []);
    expect(clipStartSec).toEqual([0, 2, 4]);
    expect(totalSec).toBeCloseTo(6, 6);
  });
});

describe('v12.264 · buildSrtWithStarts(字幕按压缩后画面起点定位)', () => {
  it('起点用显式 startSec,而非 duration 纯累加 —— 与画面/配音齐平', () => {
    const srt = buildSrtWithStarts([
      { dialogue: 'A', startSec: 0, durSec: 3 },
      { dialogue: 'B', startSec: 2.5, durSec: 4 }, // 压缩后起点 2.5,不是纯累加的 3.0
    ]);
    expect(srt).toContain('00:00:00,000 --> 00:00:03,000');
    expect(srt).toContain('00:00:02,500 --> 00:00:06,500');
  });

  it('对照 buildSrt(纯累加):同样两镜,旧版第 2 条从 3.0 起 → 证明漂移已消除', () => {
    const shots = [{ dialogue: 'A', duration: 3 }, { dialogue: 'B', duration: 4 }];
    const old = buildSrt(shots);
    expect(old).toContain('00:00:03,000 --> 00:00:07,000'); // 旧版 B 从 3.0 起(滞后)
    const fixed = buildSrtWithStarts([
      { dialogue: 'A', startSec: 0, durSec: 3 },
      { dialogue: 'B', startSec: 2.5, durSec: 4 },
    ]);
    expect(fixed).toContain('00:00:02,500 --> 00:00:06,500'); // 新版 B 提前到 2.5(与压缩画面齐平)
  });

  it('无台词镜跳过、序号连续、括号提示不入字幕(与 buildSrt 一致)', () => {
    const srt = buildSrtWithStarts([
      { dialogue: '你好', startSec: 0, durSec: 2 },
      { dialogue: '(金属撞击声)', startSec: 2, durSec: 2 }, // 整行括号 → 跳过
      { dialogue: '再见', startSec: 4, durSec: 2 },
    ]);
    expect(srt).toContain('1\n');
    expect(srt).toContain('你好');
    expect(srt).toContain('再见');
    expect(srt).not.toContain('金属撞击');
    expect(srt).toMatch(/2\n00:00:04,000/); // 第 2 条序号连续,起点 4.0
  });

  it('起点/时长缺省安全回退(startSec→0,durSec→5)', () => {
    const srt = buildSrtWithStarts([{ dialogue: 'X' }]);
    expect(srt).toContain('00:00:00,000 --> 00:00:05,000');
  });
});

describe('v12.264 · 接线:composer 三轨(画面/配音/字幕)同源于 computeXfadeTimeline', () => {
  it('配音起点 clipStartMs 与字幕起点均取自 computeXfadeTimeline 的 clipStartSec', () => {
    const src = fs.readFileSync('services/video-composer.ts', 'utf-8');
    // 配音 adelay 的 shotStartMs 取自 clipStartMs(压缩后起点),不再 durations 纯累加
    expect(src).toContain('computeXfadeTimeline(durations, effectiveTds)');
    expect(src).toContain('shotStartMs.set(sn, clipStartMs[k] || 0)');
    // 字幕重写用压缩后起点(buildSrtWithStarts + clipStartSec)
    expect(src).toContain('startSec: clipStartSec[k]');
    // 旧的纯累加 cumMs 已移除(不再 durations 逐帧累加定位配音)
    expect(src).not.toContain('cumMs += (durations[k] || 0) * 1000');
  });
});
