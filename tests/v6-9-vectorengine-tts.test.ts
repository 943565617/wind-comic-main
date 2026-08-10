/**
 * v6.9 — vectorengine TTS voice 映射 单测.
 */

import { describe, it, expect } from 'vitest';
import { mapVoiceToOpenAI } from '@/lib/tts-providers/vectorengine-tts';

/**
 * v12.229 更新:原两条断言锁的是「女声一律 nova / 男声一律 onyx」——
 * 那正是 v12.229 修掉的**塌缩 bug**:voice-routing 精心给每个角色分配了不同档位,
 * 到这里被正则一律压成 2 个 OpenAI 音色,成片里全片女角同嗓、男角同嗓。
 * 现在目录档位各自显式指定 OpenAI 音色,断言改为锁「按档位取值 + 未知才回落性别正则」。
 */
describe('v6.9 · mapVoiceToOpenAI', () => {
  it('目录档位 → 各自指定的音色(不再一律 nova/onyx)', () => {
    expect(mapVoiceToOpenAI('young_female_cn')).toBe('nova');
    expect(mapVoiceToOpenAI('narrator_female_cn')).toBe('shimmer');
    expect(mapVoiceToOpenAI('narrator_male_cn')).toBe('onyx');
    expect(mapVoiceToOpenAI('young_male_cn')).toBe('echo');
  });
  it('非目录 id → 回落性别正则(克隆音色仍可用)', () => {
    expect(mapVoiceToOpenAI('女主角')).toBe('nova');
    expect(mapVoiceToOpenAI('男配')).toBe('onyx');
  });
  it('未知/空 → alloy 兜底', () => {
    expect(mapVoiceToOpenAI('')).toBe('alloy');
    expect(mapVoiceToOpenAI(undefined)).toBe('alloy');
    expect(mapVoiceToOpenAI('robot')).toBe('alloy');
  });
});
