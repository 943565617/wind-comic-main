/**
 * v12.235 — SSRF 守卫的重定向逐跳重验。
 *
 * 由来:v12.234 刚写完 `assertOutboundUrlSafe` 就自查出致命缺口 —— 它只校验**初始 URL**,
 * 而 Node/undici 的 `fetch` 默认 `redirect: 'follow'`。攻击者给一个自己控制的公网地址,
 * 让它 302 到 `http://169.254.169.254/...`,守卫全程放行,云 IAM 凭证照样被代理回来。
 * 「写了解析层的守卫,却没跟到真正发请求的消费方」—— 与本轮字体那次是同一个病。
 *
 * 这些用例**不依赖网络也不依赖 DNS**:初始 URL 用公网 IP 字面量(守卫对 IP 字面量直接判定,
 * 不走 DNS),fetch 用 stub 返回 302。离线 CI 也能稳定跑。
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { safeFetch, assertOutboundUrlSafe } from '@/lib/ssrf-guard';

const PUBLIC_LITERAL = 'http://8.8.8.8/x';
const IMDS = 'http://169.254.169.254/latest/meta-data/iam/security-credentials/';

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; redirect?: RequestRedirect }>;

function stubFetch(map: Record<string, Response | (() => Response)>) {
  globalThis.fetch = (async (u: any, init?: RequestInit) => {
    const url = String(u);
    calls.push({ url, redirect: init?.redirect });
    const hit = map[url];
    if (!hit) return new Response('fallthrough', { status: 200 });
    return typeof hit === 'function' ? hit() : hit;
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
  delete process.env.SSRF_ALLOW_PRIVATE; // 不开逃生门,走真判定
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('v12.235 safeFetch 重定向逐跳重验', () => {
  it('前提:公网 IP 字面量本身是放行的(否则下面的用例证明不了什么)', async () => {
    expect((await assertOutboundUrlSafe(PUBLIC_LITERAL)).ok).toBe(true);
  });

  it('302 指向云元数据 → 拦住,且**根本不发出**那一跳请求', async () => {
    stubFetch({
      [PUBLIC_LITERAL]: new Response(null, { status: 302, headers: { location: IMDS } }),
      [IMDS]: new Response('SECRET-IAM-CREDENTIALS', { status: 200 }),
    });
    await expect(safeFetch(PUBLIC_LITERAL)).rejects.toThrow(/SSRF 拦截.*重定向/);
    // 关键断言:凭证那一跳从未发出 —— 只报错但已经打过去了,等于没拦
    expect(calls.map((c) => c.url)).toEqual([PUBLIC_LITERAL]);
  });

  it('始终以 redirect=manual 发请求(否则 undici 会自动跟随,守卫无从插手)', async () => {
    stubFetch({ [PUBLIC_LITERAL]: new Response('ok', { status: 200 }) });
    await safeFetch(PUBLIC_LITERAL);
    expect(calls[0].redirect).toBe('manual');
  });

  it('相对路径的 Location 按当前 URL 解析(否则相对跳转会漏判)', async () => {
    stubFetch({
      [PUBLIC_LITERAL]: new Response(null, { status: 302, headers: { location: '/next' } }),
      'http://8.8.8.8/next': new Response('done', { status: 200 }),
    });
    const r = await safeFetch(PUBLIC_LITERAL);
    expect(await r.text()).toBe('done');
    expect(calls.map((c) => c.url)).toEqual([PUBLIC_LITERAL, 'http://8.8.8.8/next']);
  });

  it('重定向链超长 → 拦住(防跳转环耗尽资源)', async () => {
    globalThis.fetch = (async (u: any, init?: RequestInit) => {
      calls.push({ url: String(u), redirect: init?.redirect });
      return new Response(null, { status: 302, headers: { location: 'http://8.8.8.8/loop' } });
    }) as typeof fetch;
    await expect(safeFetch(PUBLIC_LITERAL, {}, { maxRedirects: 3 })).rejects.toThrow(/重定向超过 3 跳/);
    expect(calls.length).toBe(4); // 初始 + 3 跳,不多不少
  });

  it('3xx 但没给 Location → 原样交回,不当成重定向', async () => {
    stubFetch({ [PUBLIC_LITERAL]: new Response(null, { status: 304 }) });
    const r = await safeFetch(PUBLIC_LITERAL);
    expect(r.status).toBe(304);
  });

  it('初始 URL 本身就内网 → 第 0 跳即拒,措辞不带「重定向」', async () => {
    stubFetch({});
    await expect(safeFetch(IMDS)).rejects.toThrow(/SSRF 拦截:内网/);
    expect(calls.length).toBe(0);
  });
});

describe('v12.235 出站 fetch 一律经守卫(防再出现裸 fetch)', () => {
  it('serve-file 的代理模式不得直接调裸 fetch', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'app', 'api', 'serve-file', 'route.ts'), 'utf-8',
    );
    expect(src.includes('safeFetch(')).toBe(true);
    // 裸 `await fetch(` 会绕开逐跳重验 —— 这条锁住的是「下一个人别再写回去」
    expect(/await fetch\(/.test(src)).toBe(false);
  });

  it('asset-storage 的外链拉取不得直接调裸 fetch', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'asset-storage.ts'), 'utf-8');
    expect(src.includes('safeFetch(')).toBe(true);
    expect(/resp = await fetch\(/.test(src)).toBe(false);
  });
});
