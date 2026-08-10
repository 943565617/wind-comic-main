/**
 * v12.211 — 引擎参数升级:情绪→MiniMax 枚举映射(纯函数)+ enable_audio/speech-2.8 接线锁。
 */
import { describe, it, expect } from 'vitest';
import { emotionToMinimaxEmotion, EMOTION_TAGS } from '@/lib/emotion-tag';
import fs from 'fs';

describe('v12.211 · 引擎参数升级', () => {
  it('中文情绪 → MiniMax 7 枚举', () => {
    expect(emotionToMinimaxEmotion('悲伤')).toBe('sad');
    expect(emotionToMinimaxEmotion('哭泣')).toBe('sad');
    expect(emotionToMinimaxEmotion('愤怒')).toBe('angry');
    expect(emotionToMinimaxEmotion('恐惧紧张')).toBe('fearful');
    expect(emotionToMinimaxEmotion('厌恶')).toBe('disgusted');
    expect(emotionToMinimaxEmotion('震惊')).toBe('surprised');
    expect(emotionToMinimaxEmotion('兴奋激动')).toBe('happy');
    expect(emotionToMinimaxEmotion('平静')).toBe('neutral');
  });
  it('枚举原样 / 空 / 未识别 → 安全', () => {
    expect(emotionToMinimaxEmotion('happy')).toBe('happy');
    expect(emotionToMinimaxEmotion('')).toBe('neutral');
    expect(emotionToMinimaxEmotion(null)).toBe('neutral');
    expect(emotionToMinimaxEmotion('莫名其妙的词')).toBe('neutral');
    expect(EMOTION_TAGS).toHaveLength(7);
  });
  it('接线:TTS 边界映射 + speech-2.8-hd 默认 + kling enable_audio 门控', () => {
    const tts = fs.readFileSync('services/tts.service.ts', 'utf-8');
    expect(tts).toContain('emotionToMinimaxEmotion(options.emotion)');
    expect(tts).toContain("'speech-2.8-hd'");
    const mm = fs.readFileSync('services/minimax.service.ts', 'utf-8');
    expect(mm).toContain('emotionToMinimaxEmotion(options.emotion)');
    const kl = fs.readFileSync('services/kling.service.ts', 'utf-8');
    expect(kl).toContain("KLING_AUDIO_ENABLED === 'true'");
    expect(kl).toContain('body.enable_audio = true');
  });
});
