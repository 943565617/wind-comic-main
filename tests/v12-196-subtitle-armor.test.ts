/**
 * v12.196 — 字幕安全加固:ja 口型诚实降级/语种嗅探/marginV 画布缩放/底板/导出路径接线。
 */
import { describe, it, expect } from 'vitest';
import { lipsyncLangCode, sniffTextLanguage } from '@/lib/language-detect';
import { buildSubtitlesFilter } from '@/lib/subtitle-burn';
import { buildCaptionForceStyle } from '@/lib/caption-style';
import fs from 'fs';

describe('v12.196 · 字幕安全加固', () => {
  it('ja 口型 = none(与 ko/ru 同,错口型比无口型更伤)', () => {
    expect(lipsyncLangCode('ja')).toBe('none');
    expect(lipsyncLangCode('ko')).toBe('none');
    expect(lipsyncLangCode('zh')).toBe('zh');
  });
  it('语种嗅探:假名→ja/谚文→ko/西里尔→ru/纯汉字→zh/拉丁→null', () => {
    expect(sniffTextLanguage('風を飼う日、彼女は笑った')).toBe('ja');
    expect(sniffTextLanguage('바람을 기르는 날입니다')).toBe('ko');
    expect(sniffTextLanguage('День, когда мы поймали ветер')).toBe('ru');
    expect(sniffTextLanguage('清晨的海岸公路,一辆流线型纯电SUV')).toBe('zh');
    expect(sniffTextLanguage('Hello world')).toBe(null);
  });
  it('burn:显式 PlayResY=1080 定坐标系(修 SRT 默认 288 空间巨字+错位的 live 真 bug)', () => {
    const f = buildSubtitlesFilter('/tmp/a.srt', 'douyin');
    expect(f).toContain('PlayResY=1080');
    expect(f).toContain('MarginV=120'); // 1080 空间设计值,libass 按输出高等比落位
    const override = buildSubtitlesFilter('/tmp/a.srt', 'douyin', { marginV: 99 });
    expect(override).toContain('MarginV=99'); // 显式覆盖仍优先
  });
  it('caption(288 空间):clean 竖屏抬 20% 安全区;social/bold 半透明底板;横屏零回归', () => {
    expect(buildCaptionForceStyle('clean', 'PingFang SC')).toContain('MarginV=40');
    expect(buildCaptionForceStyle('clean', 'PingFang SC', { vertical: true })).toContain('MarginV=58');
    const social = buildCaptionForceStyle('social', 'PingFang SC', { vertical: true });
    expect(social).toContain('BorderStyle=4');
    expect(social).toContain('BackColour=&H99000000&');
  });
  it('导出烧录路径接线:lang 嗅探 + 码率函数', () => {
    const s = fs.readFileSync('services/video-export-service.ts', 'utf-8');
    expect(s).toContain('sniffTextLanguage');
    expect(s).toContain('audioBitrateForPlatform(opts.subtitlePlatform)');
  });
});
