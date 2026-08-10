/**
 * Tests for v2.14 P0.3 — KlingService.generateFirstLastFrame validation guards
 *
 * 我们不真打 Kling API (本地 jsdom 跑不了网络), 只验前置条件:
 *   - 缺 API key → throw
 *   - 缺首帧 / 尾帧 → throw
 *   - data: URI → throw (只接 http URL)
 *
 * 注: 用全局 flag (HAS_KEY) 控 mock 行为, 不用 vi.doMock + resetModules,
 * 避免单 fork 模式下跨文件 module 状态泄漏(v2-15 套件也用了 resetModules)。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let HAS_KEY = true;

vi.mock('@/lib/config', () => ({
  get API_CONFIG() {
    return {
      keling: {
        apiKey: HAS_KEY ? 'test-key' : '',
        baseURL: 'https://api.klingai.com',
      },
    };
  },
}));

import { KlingService } from '@/services/kling.service';

beforeEach(() => {
  HAS_KEY = true;
});

describe('KlingService.generateFirstLastFrame', () => {
  it('throws when KELING_API_KEY is empty', async () => {
    HAS_KEY = false;
    const svc = new KlingService();
    await expect(
      svc.generateFirstLastFrame('http://a/1.png', 'http://a/2.png', 'p'),
    ).rejects.toThrow(/KELING_API_KEY is not configured/);
  });

  it('throws when first frame is missing', async () => {
    const svc = new KlingService();
    await expect(
      svc.generateFirstLastFrame('', 'http://a/2.png', 'p'),
    ).rejects.toThrow(/首帧.*尾帧.*都必须有/);
  });

  it('throws when last frame is missing', async () => {
    const svc = new KlingService();
    await expect(
      svc.generateFirstLastFrame('http://a/1.png', '', 'p'),
    ).rejects.toThrow(/首帧.*尾帧.*都必须有/);
  });

  it('v12.197:data: URI 不再一刀切拒绝(剥前缀成纯 base64,与 generateVideo 同口径)', async () => {
    // 官方 image/image_tail 均收「URL 或纯 base64」——零成本探测确认 v3/v2-1 都校验 image_tail。
    // 有真 key 的环境会走到网络(下一断言覆盖);无 key 环境走配置校验分支。此处只锁「不再抛 data URI 拒绝」。
    const svc = new KlingService();
    let threw: string | null = null;
    try {
      await svc.generateFirstLastFrame('data:image/png;base64,abc', 'http://a/2.png', 'p');
    } catch (e) {
      threw = e instanceof Error ? e.message : String(e);
    }
    // 允许「未配置 key」或真实 API 报错,但绝不能再是旧的「不接受 data URI」
    expect(threw).not.toMatch(/不接受 data URI/);
  });
});
