/**
 * v12.274 — 音色韵律单一真源。
 *
 * 病根:v12.229 把 VOICE_CATALOG 从 4 扩到 22,但 tts.service 的 VOICE_PROFILES **仍是 4 条** ——
 * 另外 18 档全部落进「|| 默认旁白男声」兜底,音色换了腔调没换(speed 1.0 / pitch 0)。
 * 两份表各写各的必然漂移,故本版把韵律并进目录、由 tts.service 派生。
 *
 * 本套件锁的是**结构性不变量**(不可能再漂)+ 真实请求体里的韵律。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { VOICE_CATALOG } from '@/lib/character-studio';

/** 与 tts.service 内派生逻辑同口径 */
const derive = (v: any) => ({ speed: v.speed ?? 1.0, vol: v.vol ?? 1.0, pitch: v.pitch ?? 0 });

describe('v12.274 · 韵律单一真源(结构上不可能再漂)', () => {
  it('每一档音色都有可派生的韵律 —— 数量与目录恒等', () => {
    expect(VOICE_CATALOG.length).toBeGreaterThanOrEqual(22);
    for (const v of VOICE_CATALOG) {
      const p = derive(v);
      expect(typeof p.speed, `${v.id} speed`).toBe('number');
      expect(typeof p.pitch, `${v.id} pitch`).toBe('number');
      expect(typeof p.vol, `${v.id} vol`).toBe('number');
    }
  });

  it('韵律取值在 MiniMax 合法区间内(越界会被上游拒或出怪声)', () => {
    for (const v of VOICE_CATALOG) {
      const p = derive(v);
      expect(p.speed, `${v.id} speed 越界`).toBeGreaterThanOrEqual(0.5);
      expect(p.speed, `${v.id} speed 越界`).toBeLessThanOrEqual(2.0);
      expect(p.pitch, `${v.id} pitch 越界`).toBeGreaterThanOrEqual(-12);
      expect(p.pitch, `${v.id} pitch 越界`).toBeLessThanOrEqual(12);
      expect(p.vol, `${v.id} vol 越界`).toBeGreaterThan(0);
    }
  });

  it('零回归:原 4 档数值与 v12.229 之前逐值相同', () => {
    const legacy: Record<string, { speed: number; vol: number; pitch: number }> = {
      narrator_male_cn: { speed: 1.0, vol: 1.0, pitch: 0 },
      narrator_female_cn: { speed: 1.0, vol: 1.0, pitch: 0 },
      young_male_cn: { speed: 1.1, vol: 1.0, pitch: 2 },
      young_female_cn: { speed: 1.05, vol: 1.0, pitch: 3 },
    };
    for (const [id, exp] of Object.entries(legacy)) {
      const v = VOICE_CATALOG.find((x) => x.id === id);
      expect(v, `${id} 应仍在目录中(既有项目的覆盖配置依赖它)`).toBeTruthy();
      expect(derive(v)).toEqual(exp);
    }
  });

  it('腔调真的分化了 —— 不再是清一色平调', () => {
    const flat = VOICE_CATALOG.filter((v) => derive(v).speed === 1.0 && derive(v).pitch === 0);
    // 旁白/主播档**应当**保持中性,但绝不该像修复前那样 22 档里 18 档都是平调
    expect(flat.length).toBeLessThanOrEqual(5);
    // 童声档应明显更快更高(这是修复前最刺耳的一处:奶音男孩用成熟男旁白的腔调)
    const kid = VOICE_CATALOG.find((v) => v.id === 'cute_boy_cn');
    expect(derive(kid).pitch, '奶音男孩音高应抬高').toBeGreaterThan(0);
    const lively = VOICE_CATALOG.find((v) => v.id === 'lovely_girl_cn');
    expect(derive(lively).speed, '俏皮少女语速应更快').toBeGreaterThan(1.0);
    // 低沉档应更慢更低
    const deep = VOICE_CATALOG.find((v) => v.id === 'audiobook_male2_cn');
    expect(derive(deep).pitch, '低沉厚重档音高应压低').toBeLessThan(0);
  });
});

describe('v12.274 · 真实请求体带上该档韵律', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; vi.restoreAllMocks(); });

  async function bodyFor(voiceId: string) {
    process.env.MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || 'test-key';
    const calls: any[] = [];
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body || '{}')) });
      return {
        ok: true, status: 200,
        json: async () => ({ data: { audio: '00', status: 2 }, extra_info: { audio_length: 1000 }, base_resp: { status_code: 0 } }),
      } as any;
    }) as any;
    const { TTSService } = await import('@/services/tts.service');
    await new TTSService().generateVoiceover('测试台词', { voiceId } as any).catch(() => {});
    return calls.find((c) => c.url.includes('/v1/t2a_v2'))?.body;
  }

  it('行为:俏皮少女档发出的 voice_setting 真的带自己的 speed/pitch(修复前恒为 1.0/0)', async () => {
    const body = await bodyFor('lovely_girl_cn');
    expect(body, '应打到 t2a_v2').toBeTruthy();
    const meta = VOICE_CATALOG.find((v) => v.id === 'lovely_girl_cn')!;
    expect(body.voice_setting.speed).toBe(derive(meta).speed);
    expect(body.voice_setting.pitch).toBe(derive(meta).pitch);
    expect(body.voice_setting.speed).toBeGreaterThan(1.0); // 不是旁白的 1.0
  });

  it('行为:显式 options.speed/pitch 仍优先于档位默认(调用方可覆盖)', async () => {
    process.env.MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || 'test-key';
    const calls: any[] = [];
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body || '{}')) });
      return { ok: true, status: 200, json: async () => ({ data: { audio: '00', status: 2 }, extra_info: { audio_length: 1 }, base_resp: { status_code: 0 } }) } as any;
    }) as any;
    const { TTSService } = await import('@/services/tts.service');
    await new TTSService().generateVoiceover('x', { voiceId: 'lovely_girl_cn', speed: 0.7, pitch: -5 } as any).catch(() => {});
    const b = calls.find((c) => c.url.includes('/v1/t2a_v2'))?.body;
    expect(b.voice_setting.speed).toBe(0.7);
    expect(b.voice_setting.pitch).toBe(-5);
  });
});
