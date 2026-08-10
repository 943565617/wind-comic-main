/**
 * v12.257 — 用量成本页无限重取(闪烁)修复锁。
 *
 * 根因:load = useCallback(..., [t]),而 useLocale 的 t 每渲染是新对象 → load 每渲染重建 →
 * useEffect(() => load(days), [days, load]) 每渲染重触发 → 无限 GET /api/usage/summary → 页面狂闪。
 * 修法:改用 tRef 读 t,让 load 依赖 [](稳定),effect 只在 days 变时跑一次。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.257 · 用量成本页闪烁修复', () => {
  const src = fs.readFileSync('app/dashboard/usage/page.tsx', 'utf-8');

  it('load 不再依赖 t(否则每渲染重建 → 无限重取)', () => {
    // load 的 useCallback 依赖数组不得是 [t]
    expect(src).not.toMatch(/const load = useCallback\([\s\S]*?\}, \[t\]\);/);
  });
  it('改用 tRef 读 t,load 依赖稳定', () => {
    expect(src).toContain('const tRef = useRef(t)');
    expect(src).toContain('tRef.current');
    // load 的 catch/throw 用 tRef.current 而非直接 t
    expect(src).toMatch(/tRef\.current\.usagePage\.loadFailed/);
  });
});
