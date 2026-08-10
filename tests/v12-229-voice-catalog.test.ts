/**
 * v12.229 — 音色库扩容 + 每角色独立音色 回归锁(🟠-14)。
 *
 * **实况比对抗报告更糟**(live 探测坐实,不是推测):
 *   ①目录只有 4 档(报告说 6,路线图的"校正"把它改成 6 —— 校正本身是错的);
 *   ②MiniMax 路径:`narrator_male_cn` 这类内部别名被**原样下发**,live 探测恒返回
 *     `2054 voice id not exist`,与随手编的假 id 反应一致 → routed 音色**从来没出过声**;
 *   ③vectorengine/OpenAI(生产主路径):`mapVoiceToOpenAI` 正则把一切压成 nova/onyx/alloy,
 *     "同性别池内轮转避免撞嗓"被抹平 → 实际全片女角一个嗓、男角一个嗓。
 * 本测试锁住修复后的三件事:目录容量、每档挂真实 provider 音色、8 角色真正互不撞嗓。
 */
import { describe, expect, it } from 'vitest';
import { VOICE_CATALOG } from '@/lib/character-studio';
import { buildVoiceRouting } from '@/lib/voice-routing';
import { mapVoiceToOpenAI } from '@/lib/tts-providers/vectorengine-tts';
import { resolveMinimaxVoiceId } from '@/services/tts.service';

/**
 * 经 live 探测确认**真实存在**的 MiniMax 系统音色(27 个候选中 23 个通过)。
 * 目录里的 minimax 值只允许取自本集合 —— 防有人照文档抄一个没验过的 id 进来,
 * 那会让该角色的配音静默失败(2054),而且很难被发现。
 */
const PROBED_REAL_MINIMAX_VOICES = new Set([
  'male-qn-qingse', 'male-qn-jingying', 'male-qn-badao', 'male-qn-daxuesheng',
  'female-shaonv', 'female-yujie', 'female-chengshu', 'female-tianmei',
  'presenter_male', 'presenter_female',
  'audiobook_male_1', 'audiobook_male_2', 'audiobook_female_1', 'audiobook_female_2',
  'clever_boy', 'cute_boy', 'lovely_girl', 'cartoon_pig',
  'junlang_nanyou', 'chunzhen_xuedi', 'lengdan_xiongzhang', 'badao_shaoye', 'tianxin_xiaoling',
]);

/** OpenAI 经典音色(vectorengine 走 OpenAI 兼容端点)。 */
const OPENAI_VOICES = new Set(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);

describe('v12.229 音色目录', () => {
  it('扩容到 20 档以上(原 4 档,8 角色项目每性别只有 2 个可轮转)', () => {
    expect(VOICE_CATALOG.length).toBeGreaterThanOrEqual(20);
  });

  it('每档都挂了 minimax + openai 真实音色(不留空)', () => {
    for (const v of VOICE_CATALOG) {
      expect(v.minimax, `${v.id} 缺 minimax`).toBeTruthy();
      expect(v.openai, `${v.id} 缺 openai`).toBeTruthy();
    }
  });

  it('minimax 值必须取自 live 探测确认存在的集合(防抄未验证的 id)', () => {
    for (const v of VOICE_CATALOG) {
      expect(PROBED_REAL_MINIMAX_VOICES.has(v.minimax), `${v.id} 的 minimax=${v.minimax} 未经探测确认`).toBe(true);
    }
  });

  it('openai 值必须是合法 OpenAI 音色', () => {
    for (const v of VOICE_CATALOG) {
      expect(OPENAI_VOICES.has(v.openai), `${v.id} 的 openai=${v.openai} 非法`).toBe(true);
    }
  });

  it('档位 id 唯一', () => {
    expect(new Set(VOICE_CATALOG.map((v) => v.id)).size).toBe(VOICE_CATALOG.length);
  });

  it('保留原 4 个兼容档 id(既有项目的 voice-overrides 不能失效)', () => {
    for (const legacy of ['young_female_cn', 'narrator_female_cn', 'young_male_cn', 'narrator_male_cn']) {
      expect(VOICE_CATALOG.some((v) => v.id === legacy), `丢了兼容档 ${legacy}`).toBe(true);
    }
  });

  it('男女两档都够用(各 ≥8,支撑同性别多角色不撞嗓)', () => {
    expect(VOICE_CATALOG.filter((v) => v.gender === 'male').length).toBeGreaterThanOrEqual(8);
    expect(VOICE_CATALOG.filter((v) => v.gender === 'female').length).toBeGreaterThanOrEqual(8);
  });
});

describe('v12.229 resolveMinimaxVoiceId(修 2054 真 bug)', () => {
  it('内部别名 → 真实 MiniMax id(原样下发会 2054)', () => {
    expect(resolveMinimaxVoiceId('narrator_male_cn')).toBe('presenter_male');
    expect(resolveMinimaxVoiceId('young_female_cn')).toBe('female-shaonv');
  });

  it('解析结果一定是探测确认存在的真实 id', () => {
    for (const v of VOICE_CATALOG) {
      expect(PROBED_REAL_MINIMAX_VOICES.has(resolveMinimaxVoiceId(v.id))).toBe(true);
    }
  });

  it('克隆音色 / 非目录 id → 原样透传(由 MiniMax 判定,不该被我们改写)', () => {
    expect(resolveMinimaxVoiceId('my_cloned_voice_123')).toBe('my_cloned_voice_123');
    expect(resolveMinimaxVoiceId('male-qn-badao')).toBe('male-qn-badao');
  });

  it('未知的 _cn 别名 → 兜底到探测确认存在的音色(绝不下发必然 2054 的串)', () => {
    const out = resolveMinimaxVoiceId('some_unknown_voice_cn');
    expect(PROBED_REAL_MINIMAX_VOICES.has(out)).toBe(true);
  });
});

describe('v12.229 mapVoiceToOpenAI(修 nova/onyx 塌缩)', () => {
  it('目录档位 → 各自指定的 OpenAI 音色(不再一律 nova/onyx)', () => {
    expect(mapVoiceToOpenAI('young_male_cn')).toBe('echo');
    expect(mapVoiceToOpenAI('narrator_male_cn')).toBe('onyx');
    expect(mapVoiceToOpenAI('presenter_female_cn')).toBe('fable');
  });

  it('不同男声档位能落到不同 OpenAI 音色(证明塌缩已解)', () => {
    const males = VOICE_CATALOG.filter((v) => v.gender === 'male').map((v) => mapVoiceToOpenAI(v.id));
    expect(new Set(males).size).toBeGreaterThan(1);
  });

  it('未知 id → 回落性别正则(克隆音色仍可用)', () => {
    expect(mapVoiceToOpenAI('some_female_clone')).toBe('nova');
    expect(mapVoiceToOpenAI('some_male_clone')).toBe('onyx');
    expect(mapVoiceToOpenAI('')).toBe('alloy');
  });
});

describe('v12.229 每角色独立音色(验收硬指标)', () => {
  const EIGHT = ['林月', '苏晚晴', '陈墨', '老陈', '小虎', '王婶', '赵公子', '秦医生'];

  it('8 角色 → 8 个互不相同的档位(旧实现里未知性别走全池、已知走子池,区间重叠会撞车)', () => {
    const r = buildVoiceRouting(EIGHT);
    const ids = EIGHT.map((n) => r.get(n)!);
    expect(new Set(ids).size).toBe(8);
  });

  it('8 角色 → 8 个互不相同的真实 MiniMax 音色(真正"听得出来不一样")', () => {
    const r = buildVoiceRouting(EIGHT);
    const mm = EIGHT.map((n) => resolveMinimaxVoiceId(r.get(n)!));
    expect(new Set(mm).size).toBe(8);
  });

  it('确定性:同一组角色名重复调用结果一致(跨镜同角色同嗓)', () => {
    const a = buildVoiceRouting(EIGHT);
    const b = buildVoiceRouting(EIGHT);
    for (const n of EIGHT) expect(a.get(n)).toBe(b.get(n));
  });

  it('角色数超过目录容量时才复用,且不抛错', () => {
    const many = Array.from({ length: VOICE_CATALOG.length + 5 }, (_, i) => `角色${i}`);
    const r = buildVoiceRouting(many);
    expect(r.size).toBe(many.length);
    // 前 N 个(N=目录容量)应当互异
    const firstN = many.slice(0, VOICE_CATALOG.length).map((n) => r.get(n)!);
    expect(new Set(firstN).size).toBe(VOICE_CATALOG.length);
  });
});
