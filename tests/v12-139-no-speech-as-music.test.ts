/**
 * v12.139 — 用户实测抓获:BGM 失败兜底曾用 TTS 朗读 prompt 冒充音乐(speech-02 念
 * 「诗意水墨风格背景音乐 第一幕…」),与旁白叠成重叠人声。回归锁:该兜底彻底废除。
 *
 * v12.271:grep 源码 → **真行为断言**。
 * 原锁靠「源码里含某条中文注释」,注释一改就失效,且证明不了运行时真没回退。
 * 现在让音乐接口真的失败,断言 generateMusic **抛错**且**绝不返回任何音频 URL**
 * —— 只要有人重新加回 TTS 兜底,这条立刻红。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

describe('v12.139 · 禁止 TTS 念稿冒充 BGM(v12.271 转真行为断言)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('行为:音乐接口失败时抛错,而不是悄悄返回一段「念稿」音频', async () => {
    process.env.MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || 'test-key';
    const seen: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: any) => {
      seen.push(String(url));
      return { ok: false, status: 500, text: async () => 'upstream down', json: async () => ({}) } as any;
    }) as any;
    try {
      const { MinimaxService } = await import('@/services/minimax.service');
      const svc: any = new (MinimaxService as any)();
      let threw = false;
      let returned: unknown = undefined;
      try {
        returned = await svc.generateMusic('诗意水墨风格背景音乐 第一幕');
      } catch {
        threw = true;
      }
      // 核心:必须抛错;绝不能返回 URL(返回 URL 就意味着又出现了「念稿冒充配乐」)
      expect(threw, 'generateMusic 应抛错而非兜底').toBe(true);
      expect(returned, '失败时不得返回任何音频地址').toBeUndefined();
      // 且不得顺手去打 TTS 端点
      expect(seen.some((u) => /t2a|speech/i.test(u)), '不得回落到 TTS 端点').toBe(false);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('行为:generateSpeechMusic 这个 API 已彻底不存在(不只是没被调用)', async () => {
    const { MinimaxService } = await import('@/services/minimax.service');
    const svc: any = new (MinimaxService as any)();
    expect((svc as any).generateSpeechMusic, '该方法必须已删除').toBeUndefined();
  });
});
