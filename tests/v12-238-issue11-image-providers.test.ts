/**
 * v12.238 — issue #11:GPT Image(gpt-image-1)与 Nano Banana(Gemini Image)接入图像 provider 链。
 *
 * issue 建议「新增两个 service 文件 + 改 hybrid-orchestrator 的 fallback 链」,
 * 实际按项目 v3.2 就落好的**插件 registry**(`lib/image-providers/registry.ts`)实现 ——
 * `withImagePlugin` 让注册进来的 provider 先于内置链跑、失败自动 fallback,零侵入 orchestrator。
 *
 * 这些用例全是**纯函数 + 注册表行为**,不打网络。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  gptImageSize, buildGptImageRequest, extractGptImageUrl, hasGptImage,
} from '@/lib/image-providers/openai-gpt-image';
import {
  geminiAspectHint, buildGeminiImageRequest, extractGeminiImage, hasGeminiImage,
} from '@/lib/image-providers/gemini-image';
import { selectProviders, listImageProviders } from '@/lib/image-providers/registry';
import '@/lib/image-providers/builtins';

const SAVED = { ...process.env };
beforeEach(() => {
  delete process.env.OPENAI_IMAGE_ENABLED;
  delete process.env.GEMINI_API_KEY;
});
afterEach(() => { process.env = { ...SAVED }; });

describe('v12.238 GPT Image provider', () => {
  it('画幅映射到 gpt-image-1 支持的三种 size', () => {
    expect(gptImageSize('9:16')).toBe('1024x1536');
    expect(gptImageSize('3:4')).toBe('1024x1536');
    expect(gptImageSize('1:1')).toBe('1024x1024');
    expect(gptImageSize('16:9')).toBe('1536x1024');
    expect(gptImageSize(undefined)).toBe('1536x1024');
  });

  it('请求体带 model/prompt/size,模型名可由 env 覆盖', () => {
    const r = buildGptImageRequest({ prompt: '一只猫', aspectRatio: '9:16' }, {} as NodeJS.ProcessEnv);
    expect(r.model).toBe('gpt-image-1');
    expect(r.prompt).toBe('一只猫');
    expect(r.size).toBe('1024x1536');
    expect(r.n).toBe(1);
    const r2 = buildGptImageRequest({ prompt: 'x' }, { OPENAI_IMAGE_MODEL: 'gpt-image-2' } as any);
    expect(r2.model).toBe('gpt-image-2');
  });

  it('响应解析:b64_json 优先,兼容返 url 的网关,都没有则空串', () => {
    expect(extractGptImageUrl({ data: [{ b64_json: 'QUJD' }] })).toBe('data:image/png;base64,QUJD');
    expect(extractGptImageUrl({ data: [{ url: 'https://cdn.x/a.png' }] })).toBe('https://cdn.x/a.png');
    expect(extractGptImageUrl({ data: [{}] })).toBe('');
    expect(extractGptImageUrl({})).toBe('');
    // 非 http 的 url 不当成有效图(防止把 file:// 之类塞进下游)
    expect(extractGptImageUrl({ data: [{ url: 'file:///etc/passwd' }] })).toBe('');
  });

  it('默认不启用 —— 必须显式 OPENAI_IMAGE_ENABLED=1(避免把图像请求打到只做文本的网关)', () => {
    expect(hasGptImage({ OPENAI_API_KEY: 'sk-x' } as any)).toBe(false);
    expect(hasGptImage({ OPENAI_IMAGE_ENABLED: '1' } as any)).toBe(false); // 有开关没 key 也不行
    expect(hasGptImage({ OPENAI_IMAGE_ENABLED: '1', OPENAI_API_KEY: 'sk-x' } as any)).toBe(true);
  });
});

describe('v12.238 Nano Banana (Gemini Image) provider', () => {
  it('画幅提示按比例给出构图描述(Gemini 无 size 参数,靠 prompt 引导)', () => {
    expect(geminiAspectHint('9:16')).toMatch(/9:16/);
    expect(geminiAspectHint('1:1')).toMatch(/1:1/);
    expect(geminiAspectHint(undefined)).toMatch(/16:9/);
  });

  it('请求体:参考图 part 在前、文本在后', () => {
    const refs = [{ inlineData: { mimeType: 'image/png', data: 'AAA' } }];
    const r = buildGeminiImageRequest({ prompt: '侦探站在雨里', aspectRatio: '9:16' }, refs);
    const parts = r.contents[0].parts as any[];
    expect(parts[0]).toEqual(refs[0]);
    expect(String(parts[1].text)).toContain('侦探站在雨里');
    expect(String(parts[1].text)).toMatch(/9:16/);
  });

  it('无参考图时只有文本 part', () => {
    const parts = buildGeminiImageRequest({ prompt: 'x' }).contents[0].parts as any[];
    expect(parts.length).toBe(1);
  });

  it('响应解析:取第一个 inlineData 转 data URI', () => {
    const resp = {
      candidates: [{ content: { parts: [{ text: 'ok' }, { inlineData: { mimeType: 'image/jpeg', data: 'ZZZ' } }] } }],
    };
    expect(extractGeminiImage(resp)).toBe('data:image/jpeg;base64,ZZZ');
    expect(extractGeminiImage({ candidates: [] })).toBe('');
    expect(extractGeminiImage({})).toBe('');
  });

  it('按 GEMINI_API_KEY 门控', () => {
    expect(hasGeminiImage({} as any)).toBe(false);
    expect(hasGeminiImage({ GEMINI_API_KEY: 'g' } as any)).toBe(true);
  });
});

describe('v12.238 两个 provider 接入 registry 的链路行为', () => {
  it('都已注册进 registry', () => {
    const ids = listImageProviders().map((p) => p.id);
    expect(ids).toContain('openai-gpt-image');
    expect(ids).toContain('gemini-image');
  });

  it('未配 key/未开开关 → 一个都不入链(零副作用,不干扰现有用户)', () => {
    const picked = selectProviders({ refCount: 0 }).map((p) => p.id);
    expect(picked).not.toContain('openai-gpt-image');
    expect(picked).not.toContain('gemini-image');
  });

  it('配好后按优先级入链:gemini(55)先于 gpt-image(60)', () => {
    process.env.OPENAI_IMAGE_ENABLED = '1';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.GEMINI_API_KEY = 'g-test';
    const picked = selectProviders({ refCount: 0 }).map((p) => p.id);
    expect(picked.indexOf('gemini-image')).toBeGreaterThanOrEqual(0);
    expect(picked.indexOf('gemini-image')).toBeLessThan(picked.indexOf('openai-gpt-image'));
  });

  it('有参考图时 gpt-image 被自动排除 —— 宁可不参与,也不静默丢掉参考图', () => {
    // v12.133 踩过的坑:minimax-single 静默丢 refs 导致角色一致性全崩。
    // 所以 gpt-image 如实声明 supportsRefs:false,registry 在 refCount>0 时会跳过它。
    process.env.OPENAI_IMAGE_ENABLED = '1';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.GEMINI_API_KEY = 'g-test';
    const picked = selectProviders({ refCount: 2 }).map((p) => p.id);
    expect(picked).not.toContain('openai-gpt-image');
    expect(picked).toContain('gemini-image'); // Gemini 原生 i2i,能吃参考图
  });
});
