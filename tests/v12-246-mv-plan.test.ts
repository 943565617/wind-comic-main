/**
 * v12.246 — MV(音乐视频)模式:镜头规划纯函数。
 *
 * MV 是唯一音乐驱动的创作模式:切点必须卡在拍上、副歌加密。这里锁住核心算法。
 */
import { describe, expect, it } from 'vitest';
import { planMvShots, sectionAt, summarizeMvPlan, type MvSection } from '@/lib/mv-plan';

describe('v12.246 planMvShots 卡点切镜', () => {
  it('每镜时长 = beatsPerShot × 拍长,切点落在拍上', () => {
    // 120 BPM → 拍长 0.5s;beatsPerShot=8 → 每镜 4s
    const shots = planMvShots({ musicDurationSec: 16, bpm: 120, beatsPerShot: 8 });
    expect(shots.length).toBe(4);
    for (const s of shots) expect(s.durationSec).toBeCloseTo(4, 2);
    // 切点都是 0.5s 的整数倍(落在拍网格上)
    for (const s of shots) expect(Math.round((s.startSec / 0.5)) * 0.5).toBeCloseTo(s.startSec, 2);
  });

  it('相邻镜首尾相接、无空档无重叠', () => {
    const shots = planMvShots({ musicDurationSec: 20, bpm: 100, beatsPerShot: 6 });
    for (let i = 1; i < shots.length; i++) {
      expect(shots[i].startSec).toBeCloseTo(shots[i - 1].endSec, 2);
    }
    expect(shots[0].startSec).toBe(0);
  });

  it('末镜贴合音乐结尾,不超出总时长', () => {
    const shots = planMvShots({ musicDurationSec: 15, bpm: 120, beatsPerShot: 8 }); // 4s/镜,15 除不尽
    const last = shots[shots.length - 1];
    expect(last.endSec).toBeCloseTo(15, 2);
    expect(last.endSec).toBeLessThanOrEqual(15 + 1e-6);
  });

  it('副歌段自动加密:同段每镜拍数减半 → 切得更快', () => {
    const sections: MvSection[] = [
      { kind: 'verse', startSec: 0, endSec: 16 },
      { kind: 'chorus', startSec: 16, endSec: 32 },
    ];
    const shots = planMvShots({ musicDurationSec: 32, bpm: 120, beatsPerShot: 8, sections });
    const verseShots = shots.filter((s) => s.section === 'verse');
    const chorusShots = shots.filter((s) => s.section === 'chorus');
    // verse 4s/镜 → 4 镜;chorus 2s/镜 → 8 镜(加密)
    expect(verseShots.every((s) => s.durationSec === 4)).toBe(true);
    expect(chorusShots.every((s) => s.durationSec === 2)).toBe(true);
    expect(chorusShots.length).toBeGreaterThan(verseShots.length);
  });

  it('phaseSec 前奏留白:第一镜从偏移处开始', () => {
    const shots = planMvShots({ musicDurationSec: 12, bpm: 120, beatsPerShot: 8, phaseSec: 2 });
    expect(shots[0].startSec).toBe(2);
  });

  it('高 BPM 碎镜保护:尾巴过短并入上一镜,不出现 <minShot 的碎镜', () => {
    const shots = planMvShots({ musicDurationSec: 9, bpm: 120, beatsPerShot: 8, minShotSec: 1.5 });
    for (const s of shots) expect(s.durationSec).toBeGreaterThanOrEqual(1.5);
    expect(shots[shots.length - 1].endSec).toBeCloseTo(9, 2);
  });

  it('非法输入(时长/BPM ≤ 0)→ 空数组,不抛错', () => {
    expect(planMvShots({ musicDurationSec: 0, bpm: 120 })).toEqual([]);
    expect(planMvShots({ musicDurationSec: 10, bpm: 0 })).toEqual([]);
    expect(planMvShots({ musicDurationSec: -5, bpm: 120 })).toEqual([]);
  });

  it('index 从 1 连续递增', () => {
    const shots = planMvShots({ musicDurationSec: 24, bpm: 90, beatsPerShot: 8 });
    shots.forEach((s, i) => expect(s.index).toBe(i + 1));
  });
});

describe('v12.246 sectionAt', () => {
  const sections: MvSection[] = [
    { kind: 'intro', startSec: 0, endSec: 4 },
    { kind: 'verse', startSec: 4, endSec: 20 },
    { kind: 'chorus', startSec: 20, endSec: 36 },
  ];
  it('落在区间内返回对应段;边界左闭右开', () => {
    expect(sectionAt(sections, 2)).toBe('intro');
    expect(sectionAt(sections, 4)).toBe('verse'); // 右开:4 属于 verse
    expect(sectionAt(sections, 20)).toBe('chorus');
    expect(sectionAt(sections, 40)).toBe('unknown'); // 超出
  });
  it('无段落表 → unknown', () => {
    expect(sectionAt(undefined, 5)).toBe('unknown');
  });
});

describe('v12.246 summarizeMvPlan', () => {
  it('给出镜数/总时长,副歌加密时点明', () => {
    const sections: MvSection[] = [{ kind: 'chorus', startSec: 0, endSec: 16 }];
    const shots = planMvShots({ musicDurationSec: 16, bpm: 120, beatsPerShot: 8, sections });
    const sum = summarizeMvPlan(shots);
    expect(sum).toContain('镜');
    expect(sum).toContain('副歌加密');
  });
  it('空计划有明确提示', () => {
    expect(summarizeMvPlan([])).toContain('空');
  });
});
