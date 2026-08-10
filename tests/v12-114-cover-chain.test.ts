/**
 * v12.114 — publish-package 封面链:chosen > anytext > candidate。
 */
import { describe, it, expect } from 'vitest';
import { resolveCoverChain } from '@/lib/publish-package';

describe('v12.114 · 封面优先链', () => {
  it('三级优先:定版 > AnyText > 候选首张', () => {
    expect(resolveCoverChain({ chosen: 'a', anytext: 'b', candidateFirst: 'c' })).toEqual({ url: 'a', source: 'chosen' });
    expect(resolveCoverChain({ anytext: 'b', candidateFirst: 'c' })).toEqual({ url: 'b', source: 'anytext' });
    expect(resolveCoverChain({ candidateFirst: 'c' })).toEqual({ url: 'c', source: 'candidate' });
    expect(resolveCoverChain({})).toEqual({ url: null, source: null });
  });
});
