/**
 * v12.168 — TTS 语种直达:registry 不再滤多语、builtins 透传、service language_boost。
 *
 * v12.271:grep 源码扫描 → **真行为断言**。
 * 原三条锁都是「读源码含某字符串」,对改名/挪文件/等价改写全都脆。现在改为:
 *  ① 直接读 provider 对象的 `supportedLanguages` 字段(不是 grep 字面量);
 *  ② mock 全局 fetch,**跑真的 generateVoiceover 并检查它实际发出的请求体**是否带对 language_boost;
 *  ③ 语种→boost 的映射逐个跑通(含未知语种不注入 boost 的负例)。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

/** 捕获 TTS 实际发出的请求体(不真联网)。 */
async function captureTTSBody(language?: string) {
  const calls: any[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body || '{}')) });
    // 返回一个「够用」的成功响应,让 generateVoiceover 走完主链
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: { audio: '00', status: 2 },
        extra_info: { audio_length: 1000 },
        base_resp: { status_code: 0, status_msg: 'success' },
      }),
    } as any;
  }) as any;
  try {
    const { TTSService } = await import('@/services/tts.service');
    const svc = new TTSService();
    await svc.generateVoiceover('测试台词', { language } as any).catch(() => { /* 只关心发出的请求体 */ });
  } finally {
    globalThis.fetch = orig;
  }
  return calls;
}

describe('v12.168 · TTS 语种链(v12.271 转真行为断言)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('行为:ja/ko/ru 选路时 minimax-tts 不被 registry 滤掉(病根就在这条过滤)', async () => {
    process.env.MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || 'test-key';
    await import('@/lib/tts-providers/builtins'); // 副作用注册(provider 未导出,只能经 registry 观察)
    const { selectProviders, getTTSProvider } = await import('@/lib/tts-providers/registry');
    expect(getTTSProvider('minimax-tts'), 'minimax-tts 应已注册').toBeTruthy();
    // 真正的病根是 selectProviders 里那条 supportedLanguages 过滤:
    // 此前只列 zh/en → ja/ko/ru 直接被滤没,配音静默降级。这里跑真选路验证。
    for (const lang of ['ja-JP', 'ko-KR', 'ru-RU', 'zh-CN', 'en-US']) {
      const ids = selectProviders({ language: lang } as any).map((p) => p.id);
      expect(ids, `${lang} 选路应包含 minimax-tts`).toContain('minimax-tts');
    }
  });

  it('行为:ja-JP 真的让请求体带上 language_boost=Japanese', async () => {
    const calls = await captureTTSBody('ja-JP');
    const t2a = calls.find((c) => c.url.includes('/v1/t2a_v2'));
    expect(t2a, '应打到 t2a_v2 端点').toBeTruthy();
    expect(t2a.body.language_boost).toBe('Japanese');
  });

  it('行为:9 个语种逐个映射正确(一条错就是该语种发音跑偏)', async () => {
    const expected: Array<[string, string]> = [
      ['zh-CN', 'Chinese'], ['en-US', 'English'], ['ja-JP', 'Japanese'], ['ko-KR', 'Korean'],
      ['ru-RU', 'Russian'], ['es-ES', 'Spanish'], ['fr-FR', 'French'], ['de-DE', 'German'], ['pt-BR', 'Portuguese'],
    ];
    for (const [code, boost] of expected) {
      const calls = await captureTTSBody(code);
      const t2a = calls.find((c) => c.url.includes('/v1/t2a_v2'));
      expect(t2a?.body?.language_boost, `${code} 应映射为 ${boost}`).toBe(boost);
    }
  });

  it('行为:未知/缺省语种不注入 language_boost(交给模型自动判断,不硬塞错值)', async () => {
    for (const lang of [undefined, 'xx-XX']) {
      const calls = await captureTTSBody(lang as any);
      const t2a = calls.find((c) => c.url.includes('/v1/t2a_v2'));
      expect(t2a?.body?.language_boost, `${lang} 不应注入 boost`).toBeUndefined();
    }
  });
});
