/**
 * v12.122 — MiniMax 状态终止判定:网关实返 'Fail'(无 -ed),旧 ===Failed 永不命中
 * → 白轮询 120 次到 10min 超时(e2e 实测抓获)。回归锁:Fail/Failed/failed 全部立即终止。
 */
import { describe, it, expect } from 'vitest';

const FAIL_RE = /^fail(ed)?$/i;

describe('v12.122 · MiniMax Fail 状态匹配', () => {
  it('Fail/Failed/failed/FAILED 均命中,Processing/Queueing/Success 不命中', () => {
    for (const s of ['Fail', 'Failed', 'failed', 'FAILED', 'fail']) expect(FAIL_RE.test(s)).toBe(true);
    for (const s of ['Processing', 'Queueing', 'Success', 'success', '']) expect(FAIL_RE.test(s)).toBe(false);
  });
  it('源码四处轮询终止点全部已换用宽松匹配', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('services/minimax.service.ts', 'utf-8');
    expect(src.match(/\^fail\(ed\)\?\$/g)?.length).toBe(4);
    expect(src.includes("=== 'Failed'")).toBe(false);
  });
});
