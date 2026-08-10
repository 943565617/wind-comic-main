/**
 * v12.247 — 漫转视频模式:漫画自动分格(投影法纯函数)。
 *
 * 密度数组用 1=内容、0=留白 手工构造,直观验证 gutter 检测与二维切分。
 */
import { describe, expect, it } from 'vitest';
import { findContentBands, splitIntoPanels, summarizePanels } from '@/lib/comic-panels';

/** 构造密度数组:content 区间填 1,其余 0。 */
function density(total: number, contentRanges: Array<[number, number]>): number[] {
  const a = new Array(total).fill(0);
  for (const [s, e] of contentRanges) for (let i = s; i < e; i++) a[i] = 1;
  return a;
}

describe('v12.247 findContentBands(一维 gutter 检测)', () => {
  it('两段内容中间有足够留白 → 切成两段', () => {
    // total=100:内容 0~40、留白 40~50(10px,占 10% > minGutter 2%)、内容 50~100
    const d = density(100, [[0, 40], [50, 100]]);
    const bands = findContentBands(d, 100);
    expect(bands).toEqual([[0, 40], [50, 100]]);
  });

  it('格内小空白(小于 minGutter)不切断', () => {
    // 中间只留 1px 空白(1% < minGutter 2%)→ 不算 gutter,仍是一段
    const d = density(100, [[0, 49], [50, 100]]);
    const bands = findContentBands(d, 100);
    expect(bands.length).toBe(1);
    expect(bands[0]).toEqual([0, 100]);
  });

  it('过短的内容段(小于 minBand)被过滤', () => {
    // 一段只有 3px(3% < minBand 5%),应被丢弃
    const d = density(100, [[0, 3], [20, 100]]);
    const bands = findContentBands(d, 100);
    expect(bands).toEqual([[20, 100]]);
  });

  it('条漫典型:竖向 4 格等分,横向 gutter 分隔 → 4 段', () => {
    const total = 400;
    const d = density(total, [[0, 90], [100, 190], [200, 290], [300, 390]]);
    const bands = findContentBands(d, total);
    expect(bands.length).toBe(4);
  });

  it('全空白 → 无内容段', () => {
    expect(findContentBands(new Array(100).fill(0), 100)).toEqual([]);
  });

  it('空数组 → []', () => {
    expect(findContentBands([], 0)).toEqual([]);
  });
});

describe('v12.247 splitIntoPanels(二维分格)', () => {
  it('条漫:单列多行带 → 每行带一格', () => {
    const height = 300, width = 100;
    const rowDensity = density(height, [[0, 90], [110, 200], [210, 300]]); // 3 行带
    // 每个行带内整幅都有内容(无列 gutter)→ 每带一格
    const panels = splitIntoPanels(rowDensity, () => density(width, [[0, width]]), width, height);
    expect(panels.length).toBe(3);
    expect(panels.every((p) => p.col === 0)).toBe(true); // 单列
    expect(panels[0].row).toBe(0);
    expect(panels[2].row).toBe(2);
  });

  it('四格漫画:2 行带 × 每带 2 列 → 4 格,行优先排序', () => {
    const height = 200, width = 200;
    const rowDensity = density(height, [[0, 90], [110, 200]]); // 2 行带
    // 每个行带内左右两列(中间竖 gutter)
    const colDensity = density(width, [[0, 90], [110, 200]]);
    const panels = splitIntoPanels(rowDensity, () => colDensity, width, height);
    expect(panels.length).toBe(4);
    // 行优先:row0col0, row0col1, row1col0, row1col1
    expect(panels.map((p) => [p.row, p.col])).toEqual([[0, 0], [0, 1], [1, 0], [1, 1]]);
    // 边界框正确
    expect(panels[0]).toMatchObject({ x: 0, y: 0, w: 90, h: 90 });
  });

  it('行带内无列分隔 → 整条一格(不会切出 0 宽格)', () => {
    const panels = splitIntoPanels(
      density(100, [[0, 100]]),
      () => new Array(100).fill(1), // 整行都有内容,无列 gutter
      100, 100,
    );
    expect(panels.length).toBe(1);
    expect(panels[0]).toMatchObject({ x: 0, w: 100, row: 0, col: 0 });
  });
});

describe('v12.247 summarizePanels', () => {
  it('报格数与行带数', () => {
    const panels = splitIntoPanels(
      density(200, [[0, 90], [110, 200]]),
      () => density(200, [[0, 90], [110, 200]]),
      200, 200,
    );
    expect(summarizePanels(panels)).toContain('4 格');
    expect(summarizePanels(panels)).toContain('2 行带');
  });
  it('空 → 明确提示需 CV 的不规则布局', () => {
    expect(summarizePanels([])).toContain('未检出');
  });
});
