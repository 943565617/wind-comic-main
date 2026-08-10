/**
 * v12.120 — llm-client 接入健康缓存:down 模型冷却期内被跳过;瞬时错误/超时标记 down。
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { _resetLLMHealth, markLLMDown, isLLMDown, llmKey, filterHealthyAttempts } from '@/lib/llm-health';

describe('v12.120 · llm-client 健康缓存集成', () => {
  beforeEach(() => _resetLLMHealth());
  afterEach(() => vi.unstubAllGlobals());

  it('filterHealthyAttempts:down 的端点被滤掉,全 down 保底留末位', () => {
    const A = { baseURL: 'https://g/v1', model: 'fable-5' };
    const B = { baseURL: 'https://g/v1', model: 'opus-4-6' };
    markLLMDown(llmKey(A));
    expect(filterHealthyAttempts([A, B])).toEqual([B]);
    markLLMDown(llmKey(B));
    expect(filterHealthyAttempts([A, B])).toEqual([B]); // 最后一搏
  });

  it('callLLMWithFallback 失败(网络异常)后端点进入冷却', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('socket hang up'), { name: 'FetchError' })));
    const { callLLMWithFallback, buildLLMAttempts } = await import('@/lib/llm-client');
    const { API_CONFIG } = await import('@/lib/config');
    const attempts = buildLLMAttempts(false, API_CONFIG.openai, false);
    if (attempts.length === 0) return; // 无 key 环境(CI)跳过
    const r = await callLLMWithFallback({ system: 's', user: 'u', retriesPerAttempt: 0, timeoutMs: 5000 });
    expect(r.ok).toBe(false);
    // 所有被尝试的端点均应进入冷却("socket hang up" 属瞬时网络错误)
    expect(isLLMDown(llmKey(attempts[0]))).toBe(true);
  });
});
