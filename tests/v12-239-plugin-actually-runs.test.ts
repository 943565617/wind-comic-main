/**
 * v12.239 — issue #11 的交付缺陷:注册了 provider,但它**永远不会被调用**。
 *
 * v12.238 把 GPT Image / Nano Banana 注册进 registry,并在公开 issue 上声称
 * 「配好 key 就会先于内置链跑」。**那是错的**:`getPluginChainMode()` 默认 'off',
 * 而 `runWithPlugin` 在 off 时直接 `return fallback()`、**根本不调 tryPlugin** ——
 * 于是 provider 一次也不会被执行,功能等于没接,对外声明也成了虚报。
 *
 * 当时我验的是 `selectProviders` 的排序(判定层)绿了就宣布完成,
 * 没验「这条链会不会被调用」(消费方)—— 与本轮加固里反复出现的
 * 「改了判定层没跟到消费方」是同一个病,这是第五次。
 *
 * 所以这个文件锁的不是「排序对不对」,而是 **provider 的 generate() 到底有没有被执行**。
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { registerImageProvider, clearImageProviders } from '@/lib/image-providers/registry';
import { withImagePlugin } from '@/lib/plugin-chain-router';

const SAVED = { ...process.env };

function probeProvider(id: string, opts: { available: () => boolean; fail?: boolean }) {
  const spy = vi.fn(async () => {
    if (opts.fail) throw new Error('上游 500');
    return { imageUrl: 'https://cdn.example/ok.png', provider: id };
  });
  registerImageProvider({
    id, name: `probe-${id}`, supportsRefs: true, maxRefImages: 3, priority: 55,
    available: opts.available, generate: spy as never,
  });
  return spy;
}

beforeEach(() => {
  clearImageProviders();
  delete process.env.PLUGIN_CHAIN_MODE;
  delete process.env.MOCK_ENGINES;
  delete process.env.GEMINI_API_KEY;
});
afterEach(() => { process.env = { ...SAVED }; clearImageProviders(); });

describe('v12.239 自定义图像 provider 必须真的被调用(不只是被注册)', () => {
  it('未配 key → provider 不执行,走内置 fallback(现有用户行为零变化)', async () => {
    const spy = probeProvider('gemini-image', { available: () => !!process.env.GEMINI_API_KEY });
    const r = await withImagePlugin({ prompt: 'x' }, async () => 'FALLBACK');
    expect(r).toBe('FALLBACK');
    expect(spy).not.toHaveBeenCalled();
  });

  it('配了 key → provider **真的被执行**(修复前这里恒失败:mode=off 直接 return fallback)', async () => {
    process.env.GEMINI_API_KEY = 'g-test';
    const spy = probeProvider('gemini-image', { available: () => !!process.env.GEMINI_API_KEY });
    const r = await withImagePlugin({ prompt: 'x' }, async () => 'FALLBACK');
    expect(spy).toHaveBeenCalled();
    expect(r).toBe('https://cdn.example/ok.png');
  });

  it('provider 抛错 → 自动 fallback 回内置链(不能因为新档挂了就整条断)', async () => {
    process.env.GEMINI_API_KEY = 'g-test';
    const spy = probeProvider('gemini-image', { available: () => true, fail: true });
    const r = await withImagePlugin({ prompt: 'x' }, async () => 'FALLBACK');
    expect(spy).toHaveBeenCalled();
    expect(r).toBe('FALLBACK');
  });

  it('只有内置 provider 可用时不隐含开启(避免悄悄改变现有图像链路径)', async () => {
    const spy = probeProvider('mj', { available: () => true }); // mj 属内置 id
    const r = await withImagePlugin({ prompt: 'x' }, async () => 'FALLBACK');
    expect(r).toBe('FALLBACK');
    expect(spy).not.toHaveBeenCalled();
  });

  it('显式 PLUGIN_CHAIN_MODE=off 仍然最高优先(用户能一票关掉)', async () => {
    process.env.PLUGIN_CHAIN_MODE = 'off';
    process.env.GEMINI_API_KEY = 'g-test';
    const spy = probeProvider('gemini-image', { available: () => true });
    const r = await withImagePlugin({ prompt: 'x' }, async () => 'FALLBACK');
    expect(r).toBe('FALLBACK');
    expect(spy).not.toHaveBeenCalled();
  });

  it('参考图数量参与筛选:超出 maxRefImages 的 provider 不该被选中执行', async () => {
    process.env.GEMINI_API_KEY = 'g-test';
    const spy = vi.fn(async () => ({ imageUrl: 'https://x/a.png', provider: 'narrow' }));
    registerImageProvider({
      id: 'narrow-custom', name: 'narrow', supportsRefs: true, maxRefImages: 1, priority: 50,
      available: () => true, generate: spy as never,
    });
    const r = await withImagePlugin(
      { prompt: 'x', referenceImages: ['https://a/1.png', 'https://a/2.png', 'https://a/3.png'] },
      async () => 'FALLBACK',
    );
    expect(spy).not.toHaveBeenCalled();
    expect(r).toBe('FALLBACK');
  });
});
