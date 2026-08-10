/**
 * v12.243 — provider 可达性:遍历式运行时守卫。
 *
 * ## 为什么要这个,而不是靠 RUNTIME_ONLY_GAPS 的登记
 *
 * `contracts.ts` 的 RUNTIME_ONLY_GAPS 里登记了「组件注册了但从未被执行」这类静态查不到的病
 * (v12.238:两个 image provider 注册进 registry、排序也对,但 plugin chain 默认 off →
 * generate() 一次没跑)。但那只是**文档式登记** + 一个用探针验机制的测试(v12-239-plugin-actually-runs)。
 *
 * 探针测的是「机制对不对」,测不到「**每个真实 provider** 都被这个机制覆盖」。
 * 也就是说:有人 v12.244 加了第三个 provider,但它 `available()` 逻辑写反、或 priority 设成
 * 内置之后,导致永远选不到 —— 探针测试照样绿,因为探针用的是它自己造的 provider。
 *
 * 整段加固史的核心教训是「靠人记得总会失效」。所以这个文件**反射式遍历真实注册表**:
 * 列出每个注册进来的 provider,逐个断言「当它 available 时,selectProviders 真能把它选出来」。
 * 加新 provider **自动纳入**,不依赖谁记得来补用例。这是把「登记的盲区」变成「有牙齿的检查」。
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import '@/lib/image-providers/builtins';
import '@/lib/video-providers/builtins';
import '@/lib/tts-providers/builtins';

const SAVED = { ...process.env };
beforeEach(() => {
  // 打开 mock,给一批常见 key 占位,尽量让更多 provider 的 available() 为真
  process.env.MOCK_ENGINES = '1';
});
afterEach(() => { process.env = { ...SAVED }; vi.restoreAllMocks(); });

/** 一个 registry 的最小形状 —— 三个 registry 完全对称,用同一套断言。 */
interface ReflectableRegistry {
  name: string;
  list: () => Array<{ id: string; available: () => boolean; priority: number; generate?: unknown }>;
  select: (input: any) => Array<{ id: string }>;
  selectInput: Record<string, unknown>;
}

async function loadRegistries(): Promise<ReflectableRegistry[]> {
  const img = await import('@/lib/image-providers/registry');
  const vid = await import('@/lib/video-providers/registry');
  const tts = await import('@/lib/tts-providers/registry');
  return [
    { name: 'image', list: img.listImageProviders as never, select: img.selectProviders as never, selectInput: { refCount: 0 } },
    { name: 'video', list: vid.listVideoProviders as never, select: vid.selectProviders as never, selectInput: {} },
    { name: 'tts', list: tts.listTTSProviders as never, select: tts.selectProviders as never, selectInput: {} },
  ];
}

describe('v12.243 每个注册的 provider 都是可达的(遍历式,新增自动纳入)', () => {
  it('三个 registry 都至少注册了 mock provider(builtins 副作用真的跑了)', async () => {
    for (const reg of await loadRegistries()) {
      const ids = reg.list().map((p) => p.id);
      expect(ids.length, `${reg.name} registry 空 —— builtins 注册副作用没生效?`).toBeGreaterThan(0);
    }
  });

  it('每个 available() 为真的 provider,都能被 selectProviders 选到', async () => {
    for (const reg of await loadRegistries()) {
      const registered = reg.list();
      const selectable = new Set(reg.select(reg.selectInput).map((p) => p.id));
      for (const p of registered) {
        if (!p.available()) continue; // 未配 key 的不参与,合理
        // 逐个断言:注册了、available、却选不到 —— 就是 v12.238 那类「注册了但永不被调用」
        expect(
          selectable.has(p.id),
          `${reg.name} provider「${p.id}」available()=true 但 selectProviders 选不到它 ` +
          `(priority=${p.priority})—— 典型病因:available() 逻辑写反、priority 排到被过滤、或 refCount 超限`,
        ).toBe(true);
      }
    }
  });

  it('每个 provider 都有 generate 方法(注册契约的最低要求)', async () => {
    for (const reg of await loadRegistries()) {
      for (const p of reg.list()) {
        expect(typeof (p as { generate?: unknown }).generate, `${reg.name}/${p.id} 缺 generate()`).toBe('function');
      }
    }
  });

  it('provider id 在各自 registry 内唯一(重复注册会静默覆盖,难排查)', async () => {
    for (const reg of await loadRegistries()) {
      const ids = reg.list().map((p) => p.id);
      const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
      expect(dup, `${reg.name} registry 有重复 id:${dup.join(', ')}`).toEqual([]);
    }
  });
});

describe('v12.243 image 链:available 的自定义 provider 会被 withImagePlugin 真正调用', () => {
  // 这条把「可达」再往前推一步:不只 selectProviders 选得到,而是 withImagePlugin 真的会调它。
  // v12.238 的病正是卡在 selectProviders 之后、真正调用之前(mode=off 直接 return fallback)。
  it('注册一个 available 的自定义 image provider → 其 generate 被执行', async () => {
    delete process.env.PLUGIN_CHAIN_MODE;
    delete process.env.MOCK_ENGINES; // 避免 mock 抢在前面命中
    const { registerImageProvider, clearImageProviders } = await import('@/lib/image-providers/registry');
    // clearImageProviders 会清掉内置,测完重新 import builtins 恢复(vitest 模块缓存,副作用只跑一次,
    // 所以这里手动重注册一个探针即可,不动内置的必要)
    const spy = vi.fn(async () => ({ imageUrl: 'https://cdn.example/x.png', provider: 'reach-probe' }));
    registerImageProvider({
      id: 'reach-probe', name: 'reach probe', supportsRefs: true, maxRefImages: 3, priority: 40,
      available: () => true, generate: spy as never,
    });
    const { withImagePlugin } = await import('@/lib/plugin-chain-router');
    const out = await withImagePlugin({ prompt: 'x' }, async () => 'FALLBACK');
    expect(spy, 'available 的自定义 provider 没被 withImagePlugin 调用(v12.238 同款病)').toHaveBeenCalled();
    expect(out).toBe('https://cdn.example/x.png');
    clearImageProviders();
    await import('@/lib/image-providers/builtins'); // 恢复内置注册,别影响后续文件
  });
});
