/**
 * v12.255 — 单图变视频 → MV 直达接线锁。
 * u2v 成片页「加入 MV 片段」→ /dashboard/mv?clip=<url>;MV 读 ?clip= 预填 videoClips。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.255 · u2v → MV 直达', () => {
  it('u2v 成片页有「加入 MV 片段」→ 带 clip= 跳 MV', () => {
    const p = fs.readFileSync('app/dashboard/u2v/page.tsx', 'utf-8');
    expect(p).toContain('加入 MV 片段');
    expect(p).toMatch(/\/dashboard\/mv\?clip=\$\{encodeURIComponent\(resultUrl\)\}/);
  });
  it('MV 页读 ?clip= 预填 videoClips(仅同站 serve-file / http(s))', () => {
    const p = fs.readFileSync('app/dashboard/mv/page.tsx', 'utf-8');
    expect(p).toMatch(/get\('clip'\)/);
    expect(p).toContain('setVideoClips');
    // 安全:只收 serve-file / http(s),不收 data: 之类
    expect(p).toMatch(/\/\^\(\\\/api\\\/serve-file\|https\?:\)/);
  });
});
