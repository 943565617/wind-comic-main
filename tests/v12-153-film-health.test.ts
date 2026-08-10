/**
 * v12.153 — 成片全维体检:buildFilmHealthReport 纯判定 + API/UI 接线锁 + v12.150 识别修正锁。
 */
import { describe, it, expect } from 'vitest';
import { buildFilmHealthReport, type MediaProbe } from '@/lib/film-health';
import fs from 'fs';

const goodProbe: MediaProbe = { width: 720, height: 1280, durationSec: 21, fps: 24, bitrateKbps: 1600, hasAudio: true, sizeBytes: 5_000_000 };

describe('v12.153 · buildFilmHealthReport', () => {
  it('健康成片全绿', () => {
    const r = buildFilmHealthReport({ finalProbe: goodProbe, hasFinalAsset: true, projectAspect: '9:16', expectedDurationSec: 20, shotTotal: 4, shotWithVideo: 4, animaticShots: [] });
    expect(r.overall).toBe('ok');
    expect(r.items.find((i) => i.key === 'aspect')!.status).toBe('ok');
    expect(r.items.find((i) => i.key === 'audio')!.status).toBe('ok');
  });
  it('画幅不符 fail、无音轨 fail、时长偏差 warn、降级镜 warn', () => {
    const r = buildFilmHealthReport({
      finalProbe: { ...goodProbe, width: 1280, height: 720, hasAudio: false, durationSec: 40 },
      hasFinalAsset: true, projectAspect: '9:16', expectedDurationSec: 20,
      shotTotal: 4, shotWithVideo: 3, animaticShots: [2, 4],
    });
    expect(r.overall).toBe('fail');
    expect(r.items.find((i) => i.key === 'aspect')!.status).toBe('fail');
    expect(r.items.find((i) => i.key === 'audio')!.status).toBe('fail');
    expect(r.items.find((i) => i.key === 'duration')!.status).toBe('warn');
    expect(r.items.find((i) => i.key === 'animatic')!.detail).toContain('S2、S4');
    expect(r.items.find((i) => i.key === 'shots')!.detail).toContain('1/4');
  });
  it('无成片 fail;有资产但探测失败 unknown', () => {
    expect(buildFilmHealthReport({ finalProbe: null, hasFinalAsset: false, projectAspect: '9:16', expectedDurationSec: null, shotTotal: 0, shotWithVideo: 0, animaticShots: [] }).items[0].status).toBe('fail');
    expect(buildFilmHealthReport({ finalProbe: null, hasFinalAsset: true, projectAspect: '9:16', expectedDurationSec: null, shotTotal: 0, shotWithVideo: 0, animaticShots: [] }).overall).toBe('unknown');
  });
  it('接线锁:health API(asset-repo + animaticShots 外挂)+ play/videos tab 面板与按钮', () => {
    // v12.155:取数抽到 film-health-io(asset-repo/animaticShots 断言随迁)
    const io = fs.readFileSync('lib/film-health-io.ts', 'utf-8');
    expect(io).toContain('listAssetsByType');
    expect(io).toContain('animaticShots');
    expect(fs.readFileSync('app/api/projects/[id]/health/route.ts', 'utf-8')).toContain('buildProjectHealth');
    const ui = fs.readFileSync('app/projects/[id]/page.tsx', 'utf-8');
    expect(ui).toContain('film-health-panel');
    expect(ui).toContain('healthAnimatic.has(v?.shotNumber)');
  });
  it('v12.150 识别修正锁:批量分支走 asset-repo、双 URL 测 animatic、支持 dryRun', () => {
    const src = fs.readFileSync('app/api/regenerate-shot/route.ts', 'utf-8');
    expect(src).toContain("await listAssetsByType(projectId, 'video')");
    expect(src).toContain('[a.persistent_url, urls[0]]');
    expect(src).toContain('dryRun');
  });
});
