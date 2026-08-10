import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimit, clientIp, _resetRateLimits } from '@/lib/rate-limit';

describe('rateLimit', () => {
  beforeEach(() => _resetRateLimits());

  it('放行直到达上限,之后拒绝', () => {
    const opts = { limit: 3, windowMs: 1000 };
    const t = 1000;
    expect(rateLimit('k', opts, t)).toMatchObject({ allowed: true, remaining: 2 });
    expect(rateLimit('k', opts, t)).toMatchObject({ allowed: true, remaining: 1 });
    expect(rateLimit('k', opts, t)).toMatchObject({ allowed: true, remaining: 0 });
    const blocked = rateLimit('k', opts, t);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('窗口过期后重置', () => {
    const opts = { limit: 1, windowMs: 1000 };
    expect(rateLimit('k', opts, 0).allowed).toBe(true);
    expect(rateLimit('k', opts, 500).allowed).toBe(false); // 窗口内、已满
    expect(rateLimit('k', opts, 1000).allowed).toBe(true); // 到点重置
  });

  it('不同 key 互不影响', () => {
    const opts = { limit: 1, windowMs: 1000 };
    expect(rateLimit('a', opts, 0).allowed).toBe(true);
    expect(rateLimit('b', opts, 0).allowed).toBe(true);
    expect(rateLimit('a', opts, 0).allowed).toBe(false);
  });

  it('retryAfterSec 反映剩余窗口', () => {
    const opts = { limit: 1, windowMs: 10_000 };
    rateLimit('k', opts, 0);
    const r = rateLimit('k', opts, 3000);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBe(7); // ceil((10000-3000)/1000)
  });
});

describe('clientIp', () => {
  // v12.239(第五轮对抗复检):这些用例原本锁的是「无条件采信 x-forwarded-for」——
  // 而那个头是攻击者完全可控的:①换 IP 就绕过登录爆破限流;②填受害者 IP 就能打满别人的桶。
  // 现在只有显式声明部署在受信代理之后(TRUST_PROXY_HEADERS=1)才采信,故断言随之更新,
  // 并补一条锁住「默认不信」这个新的安全默认。
  const SAVED = process.env.TRUST_PROXY_HEADERS;
  afterEach(() => {
    if (SAVED === undefined) delete process.env.TRUST_PROXY_HEADERS;
    else process.env.TRUST_PROXY_HEADERS = SAVED;
  });

  it('默认不信任代理头 —— 伪造 XFF 拿不到独立桶(防绕过 + 防打满他人桶)', () => {
    delete process.env.TRUST_PROXY_HEADERS;
    const forged = new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4' } });
    const other = new Request('http://x', { headers: { 'x-forwarded-for': '9.9.9.9' } });
    expect(clientIp(forged)).toBe('direct');
    expect(clientIp(other)).toBe('direct'); // 伪造不同 IP 也落同一个桶 → 换 IP 绕过失效
  });

  it('显式声明受信代理后,取 x-forwarded-for 首段', () => {
    process.env.TRUST_PROXY_HEADERS = '1';
    const req = new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } });
    expect(clientIp(req)).toBe('1.2.3.4');
  });
  it('受信代理下降级 x-real-ip', () => {
    process.env.TRUST_PROXY_HEADERS = '1';
    const req = new Request('http://x', { headers: { 'x-real-ip': '9.9.9.9' } });
    expect(clientIp(req)).toBe('9.9.9.9');
  });
  it('受信代理但两个头都没有 → unknown', () => {
    process.env.TRUST_PROXY_HEADERS = '1';
    expect(clientIp(new Request('http://x'))).toBe('unknown');
  });
});
