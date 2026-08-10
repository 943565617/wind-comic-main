/**
 * v12.256 — 漫转视频真片段 → 动态漫剧(按分格顺序拼接)接线锁。
 * 与 MV 的 /api/mv/compose 对称:MV 按卡点裁切硬切,漫剧按分格顺序整段拼。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.256 · 漫转真片段拼接', () => {
  it('/api/comic/compose:落地 + 顺序拼接 + 复用护栏', () => {
    const r = fs.readFileSync('app/api/comic/compose/route.ts', 'utf-8');
    expect(r).toContain('concatVideosSimple');          // 顺序拼接原语
    expect(r).toContain('persistAsset');                // 每段落地(继承 SSRF/验签/限流)
    expect(r).toContain('SAFE_VIDEO_URL');
    expect(r).toContain('inFlight');                    // 每用户单并发
    expect(r).toContain('429');
    expect(r).toContain('rmSync(scratchDir');           // 临时目录清理
    expect(r).toContain('serveFilePathUrl');            // 成片签名 URL
    expect(r).toContain('rawClips.length > 0 && videoClips.length === 0'); // 全非法 → 400 不静默
    expect(r).toMatch(/videoClips\.length < 2/);        // ≥2 段
  });
  it('comic 页可按序加真片段 + 拼成动态漫剧', () => {
    const p = fs.readFileSync('app/dashboard/comic/page.tsx', 'utf-8');
    expect(p).toContain('/api/comic/compose');
    expect(p).toContain('dramaClips');
    expect(p).toContain('addDramaClip');
    expect(p).toContain('composeDrama');
  });
  it('复检修:配乐落地失败不静默丢 —— 回传 musicDropped,前端诚实提示', () => {
    // comic + mv 两个 compose 端点同修
    for (const f of ['app/api/comic/compose/route.ts', 'app/api/mv/compose/route.ts']) {
      expect(fs.readFileSync(f, 'utf-8')).toContain('musicDropped');
    }
    for (const f of ['app/dashboard/comic/page.tsx', 'app/dashboard/mv/page.tsx']) {
      expect(fs.readFileSync(f, 'utf-8')).toMatch(/musicDropped|MusicDropped/);
    }
  });
});
