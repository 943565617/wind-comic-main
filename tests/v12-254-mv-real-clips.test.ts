/**
 * v12.254 — MV 真视频片段:卡点镜头 × 真片段 → 按拍硬切(纯映射 + 接线锁)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { planMvShots } from '@/lib/mv-plan';
import { assignMvVideoClips } from '@/lib/mv-compose-plan';

describe('v12.254 assignMvVideoClips', () => {
  const shots = planMvShots({ musicDurationSec: 32, bpm: 120, beatsPerShot: 8 });

  it('每镜分到一段真片段,时长/镜号沿用 plan', () => {
    const clips = assignMvVideoClips(shots, ['a.mp4', 'b.mp4']);
    expect(clips.length).toBe(shots.length);
    expect(clips[0].shotNumber).toBe(shots[0].index);
    expect(clips[0].durationSec).toBe(shots[0].durationSec);
  });

  it('片段不足 → 循环复用', () => {
    const clips = assignMvVideoClips(shots, ['a.mp4', 'b.mp4']);
    expect(clips[0].videoUrl).toBe('a.mp4');
    expect(clips[1]?.videoUrl).toBe('b.mp4');
    expect(clips[2]?.videoUrl).toBe('a.mp4');
  });

  it('空片段或空镜头 → 空数组', () => {
    expect(assignMvVideoClips(shots, [])).toEqual([]);
    expect(assignMvVideoClips([], ['a.mp4'])).toEqual([]);
  });
});

describe('v12.254 · MV 真片段接线锁', () => {
  it('compose 端点支持真片段模式(videoClips + 落地 + 按拍裁切复用 composeVideo)', () => {
    const r = fs.readFileSync('app/api/mv/compose/route.ts', 'utf-8');
    expect(r).toContain('videoClips');
    expect(r).toContain('assignMvVideoClips');
    expect(r).toContain('SAFE_VIDEO_URL');
    expect(r).toMatch(/mode:\s*'video'\s*\|\s*'still'|mode === 'video'/); // 二选一分支
    // 真片段仍走 persistAsset(继承 SSRF/验签/限流)+ 复用既有守卫(并发闸/temp 清理)
    expect(r).toContain('persistAsset');
    expect(r).toContain('inFlight');
    expect(r).toContain('rmSync(outputDir');
  });
  it('mv 页可加真片段 URL,填了就走真片段', () => {
    const p = fs.readFileSync('app/dashboard/mv/page.tsx', 'utf-8');
    expect(p).toContain('videoClips');
    expect(p).toContain('addClip');
    expect(p).toContain('useRealClips');
    expect(p).toMatch(/useRealClips \? \{ videoClips \}|videoClips \}/); // 有片段则发 videoClips
  });
});

describe('v12.254 · 复检修复锁', () => {
  it('#1 配乐传签名 serve-file URL(裸路径会被 composeVideo 静默丢)', () => {
    const r = fs.readFileSync('app/api/mv/compose/route.ts', 'utf-8');
    expect(r).toMatch(/musicUrl = serveFilePathUrl\(m\.absPath\)/);
  });
  it('#3 videoClips 全被过滤 → 400,不静默回退静帧', () => {
    const r = fs.readFileSync('app/api/mv/compose/route.ts', 'utf-8');
    expect(r).toContain('rawVideoClips.length > 0 && videoClips.length === 0');
  });
  it('#2 成片短于规划时长 → 诚实告警,不无脑报完成', () => {
    const p = fs.readFileSync('app/dashboard/mv/page.tsx', 'utf-8');
    expect(p).toContain('mvDuration');
    expect(p).toMatch(/mvDuration < total \* 0\.9/);
  });
});
