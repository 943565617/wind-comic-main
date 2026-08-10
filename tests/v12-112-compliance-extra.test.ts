/**
 * v12.112 — 合规词表可扩展:env 速记解析 + 自定义词编译(转义/去重/长词优先)+ 生效链路。
 */
import { describe, it, expect } from 'vitest';
import { parseExtraRuleSpec, compileCustomRules, sanitizeAdCopy, checkAdCompliance } from '@/lib/ad-compliance';

describe('v12.112 · 合规词表扩展', () => {
  it('parseExtraRuleSpec:分号(中英)分段,= 切词,空段丢弃', () => {
    expect(parseExtraRuleSpec('秒杀全场=限时优惠;躺赚=轻松收益')).toEqual([
      { word: '秒杀全场', replacement: '限时优惠' },
      { word: '躺赚', replacement: '轻松收益' },
    ]);
    expect(parseExtraRuleSpec('坏段;好词=好替换；=没词')).toEqual([{ word: '好词', replacement: '好替换' }]);
    expect(parseExtraRuleSpec(undefined)).toEqual([]);
  });

  it('compileCustomRules:regex 特殊字符转义 + 去重 + 长词在前', () => {
    const rules = compileCustomRules([
      { word: '赚', replacement: 'A' },
      { word: '躺着赚(大钱)', replacement: 'B' },
      { word: '赚', replacement: 'C' },
    ]);
    expect(rules.length).toBe(2);
    expect(rules[0].word).toBe('躺着赚(大钱)');
    expect('轻松躺着赚(大钱)'.replace(rules[0].re, rules[0].replacement)).toBe('轻松B');
    expect(rules[1].category).toBe('自定义');
  });

  it('env 通道端到端:自定义词被替换,命中带类别', () => {
    const env = { AD_COMPLIANCE_EXTRA: '稳赚不赔=收益可期' } as any;
    const hits = checkAdCompliance('这款理财稳赚不赔', env);
    expect(hits.some((h) => h.word === '稳赚不赔' && h.category === '自定义')).toBe(true);
    expect(sanitizeAdCopy('这款理财稳赚不赔', env).text).toBe('这款理财收益可期');
  });

  it('内置表不受影响(回归)', () => {
    expect(sanitizeAdCopy('全网第一的顶级精华').text).toBe('全网热销的高端精华');
  });
});
