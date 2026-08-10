/**
 * v12.170 — 语种专属音色映射:纯函数(env 注入)+ service 接线锁。
 */
import { describe, it, expect } from 'vitest';
import { voiceForLanguage, langKeyOf, genderOf } from '@/lib/tts-voice-map';
import fs from 'fs';

describe('v12.170 · voiceForLanguage', () => {
  it('env 性别专属 > env 语种通用 > 无配置 null;中文永不介入', () => {
    const env = { TTS_VOICE_JA_FEMALE: 'jp-f-1', TTS_VOICE_JA: 'jp-any', TTS_VOICE_KO: 'kr-any' };
    expect(voiceForLanguage('ja-JP', 'female-zh', env)).toBe('jp-f-1');
    expect(voiceForLanguage('ja-JP', 'male-zh', env)).toBe('jp-any');   // 无 JA_MALE → 语种通用
    expect(voiceForLanguage('ko-KR', 'narrator_female_cn', env)).toBe('kr-any');
    expect(voiceForLanguage('ru-RU', 'male-zh', env)).toBeNull();       // 没配 → null(保持原音色)
    expect(voiceForLanguage('zh-CN', 'male-zh', env)).toBeNull();       // 中文不介入
    expect(voiceForLanguage(undefined, 'male-zh', env)).toBeNull();
  });
  it('langKeyOf/genderOf 解析', () => {
    expect(langKeyOf('ja-JP')).toBe('JA');
    expect(langKeyOf('bad')).toBeNull();
    expect(genderOf('female-zh')).toBe('FEMALE');
    expect(genderOf('narrator_male_cn')).toBe('MALE');
  });
  it('接线锁:generateVoiceover 按 language 换音色', () => {
    const s = fs.readFileSync('services/tts.service.ts', 'utf-8');
    expect(s).toContain('voiceForLanguage(options.language, voiceId)');
    expect(s).toContain('if (langVoice) voiceId = langVoice;');
  });
});
