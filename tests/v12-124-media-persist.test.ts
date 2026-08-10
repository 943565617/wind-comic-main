/**
 * v12.124 — 持久媒体目录:路径必在 cwd/data/media 下,绝不落 tmpdir(防 macOS GC 导致 recompose 404)。
 */
import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';
import { persistentMediaDir, persistentMediaPath } from '@/lib/media-persist';

describe('v12.124 · 持久媒体目录', () => {
  it('目录落 cwd/data/media/<kind>,不含 tmpdir', () => {
    const d = persistentMediaDir('audio');
    expect(d).toBe(path.join(process.cwd(), 'data', 'media', 'audio'));
    expect(d.startsWith(os.tmpdir())).toBe(false);
  });
  it('kind 做安全过滤(去路径穿越)', () => {
    const d = persistentMediaDir('../../etc');
    expect(d).toBe(path.join(process.cwd(), 'data', 'media', '______etc'));
  });
  it('persistentMediaPath 拼全名', () => {
    expect(persistentMediaPath('images', 'x.png')).toBe(path.join(process.cwd(), 'data', 'media', 'images', 'x.png'));
  });
});

describe('v12.124 · 落盘点迁移锁', () => {
  it('minimax 音频 / orchestrator 图像不再写 os.tmpdir', async () => {
    const fs = await import('fs');
    const mnx = fs.readFileSync('services/minimax.service.ts', 'utf-8');
    const orch = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    expect(mnx).not.toContain("os.tmpdir(), 'qf-audio'");
    expect(mnx).toContain("persistentMediaDir('audio')");
    expect(orch).not.toContain("os.tmpdir(), 'qf-images'");
    expect(orch).toContain("persistentMediaDir('images')");
  });
});
