/**
 * v12.195 — 音频质量批:闪避收紧(env 可调)/分平台码率/SRT 终值重写/BGM 尾淡出/人声 EQ。
 */
import { describe, it, expect } from 'vitest';
import { buildDuckingFilters } from '@/lib/audio-ducking';
import { audioBitrateForPlatform } from '@/lib/audio-encode';
import fs from 'fs';

describe('v12.195 · 音频质量批', () => {
  it('闪避默认收紧到 attack=20/release=350/ratio=4', () => {
    const p = buildDuckingFilters('[m]', '[v]', {} as any);
    expect(p.filters[1]).toContain('ratio=4:attack=20:release=350');
  });
  it('env 可调且越界回默认', () => {
    const p = buildDuckingFilters('[m]', '[v]', { BGM_DUCK_ATTACK: '60', BGM_DUCK_RELEASE: '500', BGM_DUCK_RATIO: '8' } as any);
    expect(p.filters[1]).toContain('ratio=8:attack=60:release=500');
    const bad = buildDuckingFilters('[m]', '[v]', { BGM_DUCK_ATTACK: '99999', BGM_DUCK_RATIO: 'abc' } as any);
    expect(bad.filters[1]).toContain('ratio=4:attack=20');
  });
  it('码率:社媒 192k,默认 160k', () => {
    expect(audioBitrateForPlatform('douyin')).toBe('192k');
    expect(audioBitrateForPlatform('TikTok')).toBe('192k');
    expect(audioBitrateForPlatform('bilibili')).toBe('160k');
    expect(audioBitrateForPlatform(undefined)).toBe('160k');
  });
  it('composer 接线锁:SRT 终值重写/BGM 尾淡出/人声EQ/平台码率', () => {
    const s = fs.readFileSync('services/video-composer.ts', 'utf-8');
    expect(s).toContain('srtResyncPath');
    expect(s.match(/afade=t=out:st=\$\{bgmFadeSt\}/g)?.length).toBe(2); // 单镜+多镜两路
    expect(s).toContain('highpass=f=80,lowpass=f=12000');
    expect(s).toContain('audioBitrateForPlatform(options.platform)');
    expect(s).not.toMatch(/'-b:a', '128k'/); // 仅剩模板串里的静音卡 128k
  });
});
