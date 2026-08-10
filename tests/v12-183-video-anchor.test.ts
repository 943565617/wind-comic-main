/**
 * v12.183 — 视频角色锚抽帧:接线锁(live 已验:成片抽 3 帧 serve-file URLs)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.183 · 视频角色锚', () => {
  it('lib:ffprobe 时长→掐头去尾均匀抽帧→持久目录;失败空数组', () => {
    const s = fs.readFileSync('lib/video-anchor.ts', 'utf-8');
    expect(s).toContain('extractAnchorFrames');
    expect(s).toContain('serveFileToLocalPath');
    expect(s).toContain("return []");
    expect(s).toContain('persistentMediaDir');
  });
  it('API:auth + URL 白名单 + frames 1-6 clamp', () => {
    const r = fs.readFileSync('app/api/tools/video-anchor/route.ts', 'utf-8');
    expect(r).toContain('getUserFromRequest');
    expect(r).toContain('Math.min(6, Math.max(1');
    expect(r).toContain('/api\\/serve-file');
  });
});
