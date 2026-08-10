/**
 * v12.212 — Kling lip-sync body 修正 + 字幕描边底板优化。
 */
import { describe, it, expect } from 'vitest';
import { buildSubtitlesFilter, styleToForceStyle, getSubtitleStyle } from '@/lib/subtitle-burn';
import fs from 'fs';

describe('v12.212 · lip-sync + 字幕描边', () => {
  it('Kling lip-sync body 修正:mode=audio2video + audio_type=url(旧 audio_url 非法)', () => {
    const p = fs.readFileSync('services/lipsync-providers.ts', 'utf-8');
    expect(p).toContain("mode: 'audio2video'");
    expect(p).toContain("audio_type: 'url'");
    expect(p).not.toContain("audio_type: 'audio_url'"); // 旧非法值已除
  });
  it('社媒预设(douyin)半透明底板 + Blur 软化描边', () => {
    const f = buildSubtitlesFilter('/tmp/a.srt', 'douyin');
    expect(f).toContain('BorderStyle=4');
    expect(f).toContain('BackColour=&H99000000');
    expect(f).toContain('Blur=0.6');
  });
  it('非社媒预设(youtube)不加底板但仍软化描边', () => {
    const f = styleToForceStyle(getSubtitleStyle('youtube'));
    expect(f).not.toContain('BorderStyle=4');
    expect(f).toContain('Blur=0.6');
  });
});
