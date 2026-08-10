/**
 * v12.273 — 风格预设库 64 → 155。
 *
 * 这批是**内容资产**,最大风险不是崩,而是「悄悄注水」:重复、同质、写了对模型无效的空泛词。
 * 所以本套件不只验数量,重点验**去重与 promptFragment 的可用性**。
 */
import { describe, it, expect } from 'vitest';
import {
  STYLE_PRESETS,
  getStyleById,
  getStylesByCategory,
  applyStyleToPrompt,
  getStyleNegativePrompt,
} from '@/lib/style-presets';

const NEW_SINCE_273 = 91;
const TOTAL = 155;

describe('v12.273 · 规模与完整性', () => {
  it(`总数 ${TOTAL},且每条字段完整`, () => {
    expect(STYLE_PRESETS).toHaveLength(TOTAL);
    for (const p of STYLE_PRESETS) {
      expect(p.id, `${p.id} 缺 id`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(p.name.length, `${p.id} 中文名为空`).toBeGreaterThan(0);
      expect(p.nameEn.length, `${p.id} 英文名为空`).toBeGreaterThan(0);
      expect(['realistic', 'anime', 'artistic', 'retro', 'experimental']).toContain(p.category);
      expect(p.thumbnail, `${p.id} 缩略图路径应按 id 约定`).toBe(`/styles/${p.id}.jpg`);
      expect(p.popularity).toBeGreaterThanOrEqual(0);
      expect(p.popularity).toBeLessThanOrEqual(100);
    }
  });

  it('扩容规模符合预期(相对原 64)', () => {
    expect(STYLE_PRESETS.length - 64).toBe(NEW_SINCE_273);
  });
});

describe('v12.273 · 去重(内容库最容易注水的地方)', () => {
  it('id / 中文名 / 英文名 三者各自全库唯一', () => {
    const dup = (arr: string[]) => arr.filter((v, i, a) => a.indexOf(v) !== i);
    expect(dup(STYLE_PRESETS.map((p) => p.id))).toEqual([]);
    expect(dup(STYLE_PRESETS.map((p) => p.name.trim()))).toEqual([]);
    expect(dup(STYLE_PRESETS.map((p) => p.nameEn.trim().toLowerCase()))).toEqual([]);
  });

  it('promptFragment 不得整段雷同(同质化的硬指标)', () => {
    const norm = (s: string) => s.toLowerCase().replace(/[\s,]+/g, ' ').trim();
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const p of STYLE_PRESETS) {
      const k = norm(p.promptFragment);
      if (seen.has(k)) clashes.push(`${p.id} ≡ ${seen.get(k)}`);
      seen.set(k, p.id);
    }
    expect(clashes).toEqual([]);
  });
});

describe('v12.273 · promptFragment 可用性', () => {
  it('新增条目不得含对现代模型无效的空泛词', () => {
    // hyperrealism 是 v12.273 之前就存在的历史条目(promptFragment 含 8k),本版不改动既有内容,单独豁免。
    const LEGACY_EXEMPT = new Set(['hyperrealism']);
    const junk = STYLE_PRESETS
      .filter((p) => !LEGACY_EXEMPT.has(p.id))
      .filter((p) => /\b(masterpiece|best quality|high quality|4k|8k|beautiful|stunning|award winning)\b/i.test(p.promptFragment));
    expect(junk.map((p) => p.id)).toEqual([]);
  });

  it('每条至少 4 个具体视觉词(逗号分隔),不是一句空话', () => {
    const thin = STYLE_PRESETS.filter((p) => p.promptFragment.split(',').filter((x) => x.trim().length > 2).length < 4);
    expect(thin.map((p) => p.id)).toEqual([]);
  });
});

describe('v12.273 · 新风格真的可被消费', () => {
  it('新条目能按 id 取到,并真的拼进 prompt 尾部', () => {
    const probe = getStyleById('golden-hour-rim');
    expect(probe).toBeTruthy();
    const out = applyStyleToPrompt('一个女孩站在窗前', 'golden-hour-rim');
    expect(out).toContain('一个女孩站在窗前');
    expect(out).toContain('magic hour backlight'); // 真注入,不是只存不用
  });

  it('负面词可被取出(有配的条目)', () => {
    expect(getStyleNegativePrompt('golden-hour-rim')).toContain('flat light');
    expect(getStyleNegativePrompt('不存在的风格')).toBeUndefined();
  });

  it('分类检索覆盖扩容后的全部条目', () => {
    const sum = (['realistic', 'anime', 'artistic', 'retro', 'experimental'] as const)
      .reduce((n, c) => n + getStylesByCategory(c).length, 0);
    expect(sum).toBe(TOTAL);
  });
});
