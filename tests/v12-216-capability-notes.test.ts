/**
 * v12.216 — 引擎能力边界告知:上下文触发的纯函数 + 天气条/api-status/成片体检三面接线锁。
 */
import { describe, it, expect } from 'vitest';
import { engineCapabilityNotes } from '@/lib/engine-capability-notes';
import { weatherSegments } from '@/components/create/engine-weather';
import fs from 'fs';

describe('v12.216 · 引擎能力边界告知', () => {
  it('默认(env 全关 + zh)零提示 —— 不打扰', () => {
    expect(engineCapabilityNotes({ env: {} as any, language: 'zh' })).toEqual([]);
    expect(engineCapabilityNotes({ env: {} as any })).toEqual([]);
  });
  it('KLING_AUDIO_ENABLED=true → warn「原生音效不可用」(开了不生效的开关必须知情)', () => {
    const notes = engineCapabilityNotes({ env: { KLING_AUDIO_ENABLED: 'true' } as any });
    expect(notes).toHaveLength(1);
    expect(notes[0].severity).toBe('warn');
    expect(notes[0].text).toContain('Kling 账号原生音效不可用');
    expect(notes[0].text).toContain('TTS+BGM');
  });
  it('ja/ko/ru 语种 → info 口型降级说明;zh/en 不触发', () => {
    for (const lang of ['ja', 'ko', 'ru']) {
      const notes = engineCapabilityNotes({ env: {} as any, language: lang });
      expect(notes.some((n) => n.key === 'lipsyncNone' && n.severity === 'info')).toBe(true);
    }
    expect(engineCapabilityNotes({ env: {} as any, language: 'en' })).toEqual([]);
  });
  it('KLING_CAMERA_MODEL → info 画质权衡说明', () => {
    const notes = engineCapabilityNotes({ env: { KLING_CAMERA_MODEL: 'kling-v1-5' } as any });
    expect(notes.some((n) => n.key === 'cameraTradeoff' && n.text.includes('以画质换运镜'))).toBe(true);
  });
  it('天气条消费 capabilityNotes(⚙️ 前缀);api-status/体检接线', () => {
    const segs = weatherSegments([], [], [], [{ text: 'Kling 原生音效不可用' }]);
    expect(segs).toEqual(['⚙️ Kling 原生音效不可用']);
    expect(fs.readFileSync('app/api/api-status/route.ts', 'utf-8')).toContain('capabilityNotes');
    const fh = fs.readFileSync('lib/film-health-io.ts', 'utf-8');
    expect(fh).toContain('engineCapabilityNotes');
    expect(fh).toContain('sniffTextLanguage');
  });
});
