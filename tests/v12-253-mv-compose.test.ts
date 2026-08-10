/**
 * v12.253 — MV 出片:卡点镜头 + 图片 → 静帧动画规格(纯映射)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { planMvShots } from '@/lib/mv-plan';
import { assignMvClips } from '@/lib/mv-compose-plan';

describe('v12.253 · MV 出片接线锁', () => {
  it('compose 端点存在 + 落地(继承 SSRF/限流)+ 镜头封顶 + 签名 URL', () => {
    const r = fs.readFileSync('app/api/mv/compose/route.ts', 'utf-8');
    expect(r).toContain('persistAsset');       // 每图落地,继承 SSRF/验签/大小上限
    expect(r).toContain('stillFrameToVideo');
    expect(r).toContain('composeVideo');
    expect(r).toContain('MAX_MV_SHOTS');        // 出片镜头封顶防超时
    expect(r).toContain('serveFilePathUrl');    // 成片签名 URL
  });
  it('mv 页调 compose 端点 + 传画面', () => {
    const p = fs.readFileSync('app/dashboard/mv/page.tsx', 'utf-8');
    expect(p).toContain('/api/mv/compose');
    expect(p).toContain('imageUrls');
  });

  // 复检确认的 4 洞的防回归锁
  it('复检修:临时目录 finally 清理 + 每用户单并发 + 尺寸护栏', () => {
    const r = fs.readFileSync('app/api/mv/compose/route.ts', 'utf-8');
    expect(r).toMatch(/finally\s*\{/);              // 有 finally
    expect(r).toContain('rmSync(outputDir');        // 清中间片段目录
    expect(r).toContain('inFlight');                // 每用户并发闸
    expect(r).toContain('429');                     // 在途 → 429
    expect(r).toContain('MAX_IMAGE_DIM');           // 像素上限
    expect(r).toMatch(/sharp\(.*\)\.metadata\(\)|\.metadata\(\)/); // 读声明尺寸卡上限
  });
  it('复检修:出片用规划快照参数(镜头数与显示的时间轴一致)', () => {
    const p = fs.readFileSync('app/dashboard/mv/page.tsx', 'utf-8');
    expect(p).toContain('plannedParams');
    expect(p).toMatch(/plannedParams\.durationSec/); // compose 用快照而非 live 输入
  });
});

describe('v12.253 assignMvClips', () => {
  const shots = planMvShots({ musicDurationSec: 32, bpm: 120, beatsPerShot: 8 });

  it('每个卡点镜头分到一段规格,时长/镜号沿用 plan', () => {
    const clips = assignMvClips(shots, ['a.png', 'b.png']);
    expect(clips.length).toBe(shots.length);
    expect(clips[0].shotNumber).toBe(shots[0].index);
    expect(clips[0].durationSec).toBe(shots[0].durationSec);
  });

  it('图片不足 → 循环复用', () => {
    const clips = assignMvClips(shots, ['a.png', 'b.png']);
    expect(clips[0].imageUrl).toBe('a.png');
    expect(clips[1]?.imageUrl).toBe('b.png');
    expect(clips[2]?.imageUrl).toBe('a.png'); // 回到第一张
  });

  it('ken-burns 方向逐镜轮换', () => {
    const clips = assignMvClips(shots, ['a.png']);
    expect(clips[0].zoomDir).toBe('in');
    expect(clips[1]?.zoomDir).toBe('out');
    expect(clips[2]?.zoomDir).toBe('pan');
    expect(clips[3]?.zoomDir).toBe('in');
  });

  it('空图片或空镜头 → 空数组', () => {
    expect(assignMvClips(shots, [])).toEqual([]);
    expect(assignMvClips([], ['a.png'])).toEqual([]);
  });
});
