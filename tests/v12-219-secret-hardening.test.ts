/**
 * v12.219 — 密钥与配置硬化回归锁。
 *
 * 两条尽调尾链:
 *   🔴-2 尾:JWT_SECRET 弱默认(.env.example 的 change_me_...)在生产可被据此伪造任意用户令牌。
 *   🟠-12:PLAN_GATE_DISABLED 误留生产 → 付费墙全开。
 *
 * 真行为断言(非 grep 源码):直接改 process.env 触发 getJwtSecret / checkPlan 的运行时分支,
 * 断言「生产弱密钥拒签发」「生产强制忽略 gate 开关」。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { signToken } from '@/app/api/auth/lib';
import { checkPlan } from '@/lib/plan-gate';

const ENV_KEYS = ['NODE_ENV', 'JWT_SECRET', 'PLAN_GATE_DISABLED'] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function setEnv(k: string, v: string | undefined) {
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

describe('v12.219 JWT_SECRET 弱默认生产拒启', () => {
  const WEAK = 'change_me_to_a_random_32_char_string';

  it('生产 + 弱默认 JWT_SECRET → signToken 抛错(拒签发)', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('JWT_SECRET', WEAK);
    expect(() => signToken({ id: 'u1', role: 'user' })).toThrow(/占位|弱默认|weak/i);
  });

  it('生产 + 弱默认大小写/空格变体 → 仍拒(规范化挡绕过)', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('JWT_SECRET', '  Change_Me  ');
    expect(() => signToken({ id: 'u1', role: 'user' })).toThrow();
  });

  it('生产 + 未设 JWT_SECRET → signToken 抛错', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('JWT_SECRET', undefined);
    expect(() => signToken({ id: 'u1', role: 'user' })).toThrow(/未设置|JWT_SECRET/i);
  });

  it('生产 + 高强度随机密钥 → 正常签发', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('JWT_SECRET', 'a3f9c1e7b28d4056af9127c3e5b8d0f1a3f9c1e7b28d4056af9127c3e5b8d0f1');
    const t = signToken({ id: 'u1', role: 'user' });
    expect(typeof t).toBe('string');
    expect(t.split('.').length).toBe(3);
  });

  it('非生产 + 弱默认 → 不抛错(仅告警)', () => {
    setEnv('NODE_ENV', 'development');
    setEnv('JWT_SECRET', WEAK);
    expect(() => signToken({ id: 'u1', role: 'user' })).not.toThrow();
  });

  /**
   * v12.226 回归锁:v12.219 初版在非生产下把弱密钥**忽略并替换成进程级随机密钥**,
   * 这会让「多进程共用一个 fixture 密钥」的场景崩掉 —— e2e 里 dev server 与测试进程
   * 各自随机 → JWT 不匹配 → 全 401,而 .env.example 恰恰就教用户这么跑本地 e2e。
   * 现在:非生产下显式设置的密钥**必须被真正采用**,只告警。
   */
  it('非生产 + 显式弱密钥 → 该密钥被真正采用(e2e 多进程共享密钥的前提)', () => {
    setEnv('NODE_ENV', 'test');
    setEnv('JWT_SECRET', 'e2e-fixture-secret-not-for-prod');
    const token = signToken({ id: 'u-e2e', role: 'user' });
    // 用同一串独立校验:能验通 ⇒ 签发用的确实是这串,而非进程内随机值
    const decoded = jwt.verify(token, 'e2e-fixture-secret-not-for-prod') as { sub: string };
    expect(decoded.sub).toBe('u-e2e');
  });

  it('非生产 + 未设密钥 → 才回落进程级随机(签发仍可用)', () => {
    setEnv('NODE_ENV', 'development');
    setEnv('JWT_SECRET', undefined);
    const t = signToken({ id: 'u2', role: 'user' });
    expect(t.split('.').length).toBe(3);
    // 随机密钥下,用弱串校验必然失败(证明没被误用成固定弱串)
    expect(() => jwt.verify(t, 'change_me')).toThrow();
  });
});

describe('v12.219 PLAN_GATE_DISABLED 生产强制忽略', () => {
  // 匿名请求(无 token)→ current=free;要 pro 档。
  const req = () => new Request('http://localhost/api/x');

  it('生产 + PLAN_GATE_DISABLED=1 → 仍 gate(免费用户 pro 功能被拦)', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('PLAN_GATE_DISABLED', '1');
    const r = checkPlan(req(), 'pro');
    expect(r.ok).toBe(false);
    expect(r.current).toBe('free');
  });

  it('开发 + PLAN_GATE_DISABLED=1 → 放行(开关仅 dev 生效)', () => {
    setEnv('NODE_ENV', 'development');
    setEnv('PLAN_GATE_DISABLED', '1');
    const r = checkPlan(req(), 'pro');
    expect(r.ok).toBe(true);
  });

  it('开发 + 未设开关 → 免费用户 pro 功能被 gate', () => {
    setEnv('NODE_ENV', 'development');
    setEnv('PLAN_GATE_DISABLED', undefined);
    const r = checkPlan(req(), 'pro');
    expect(r.ok).toBe(false);
  });
});
