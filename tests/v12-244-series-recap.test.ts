/**
 * v12.244 — 多集连续生成:前情提要。
 *
 * 竞品差距「多集连续」的实质:series 批量出片时,每集 Writer 只看到自己那集的梗概,
 * 不知道前几集演了什么 → 各集独立成篇。本版给每集注入「前情提要」(前序各集 description)。
 */
import { describe, expect, it } from 'vitest';
import { buildSeriesRecap, buildRecapDirective, type EpisodeLike } from '@/lib/series-recap';

const EPS: EpisodeLike[] = [
  { episode_number: 1, title: '相遇', description: '林深在雨夜地铁口捡到失忆的苏晚,收留了她。' },
  { episode_number: 2, title: '线索', description: '苏晚想起自己是被追杀的证人,林深决定帮她查真相。' },
  { episode_number: 3, title: '反转', description: '真凶竟是林深失联多年的哥哥。' },
];

describe('v12.244 buildSeriesRecap', () => {
  it('第 1 集无前情 → 空串(directive 也为空,对首集零影响)', () => {
    expect(buildSeriesRecap(EPS, 1)).toBe('');
    expect(buildRecapDirective(buildSeriesRecap(EPS, 1))).toBe('');
  });

  it('第 3 集前情含且仅含第 1、2 集,按集号升序', () => {
    const recap = buildSeriesRecap(EPS, 3);
    expect(recap).toContain('第1集:');
    expect(recap).toContain('第2集:');
    expect(recap).not.toContain('第3集:'); // 不含本集
    expect(recap.indexOf('第1集')).toBeLessThan(recap.indexOf('第2集'));
  });

  it('乱序输入也能正确排序取前序', () => {
    const shuffled = [EPS[2], EPS[0], EPS[1]];
    expect(buildSeriesRecap(shuffled, 3)).toBe(buildSeriesRecap(EPS, 3));
  });

  it('没有 description 的集用 title 兜底;两者都空则跳过(不占前情篇幅)', () => {
    const eps: EpisodeLike[] = [
      { episode_number: 1, title: '开场', description: '' },
      { episode_number: 2, title: '', description: '' },
      { episode_number: 3, description: '本集' },
    ];
    const recap = buildSeriesRecap(eps, 4);
    expect(recap).toContain('第1集:开场'); // title 兜底
    expect(recap).not.toContain('第2集'); // 全空 → 跳过
    expect(recap).toContain('第3集:本集');
  });

  it('集号缺失(null)→ 安全返空,不抛错', () => {
    expect(buildSeriesRecap(EPS, null)).toBe('');
    const withNull: EpisodeLike[] = [{ episode_number: null, description: 'x' }, ...EPS];
    expect(buildSeriesRecap(withNull, 2)).toContain('第1集'); // null 集被过滤,不影响
  });

  it('长系列超总量上限时,保留最近的集(近因优先),而非从第 1 集截断', () => {
    const many: EpisodeLike[] = Array.from({ length: 40 }, (_, i) => ({
      episode_number: i + 1,
      description: `第${i + 1}集发生了一件很长很长很长很长很长很长很长很长很长很长很长的事情要占很多字数`,
    }));
    const recap = buildSeriesRecap(many, 40);
    expect(recap.length).toBeLessThanOrEqual(1700); // 受 TOTAL_CAP 约束
    expect(recap).toContain('第39集'); // 最近的一定保留
    expect(recap).not.toContain('第1集:'); // 最早的被挤掉
  });

  it('单集描述过长被截断到 PER_EP_CAP', () => {
    const long: EpisodeLike[] = [
      { episode_number: 1, description: 'A'.repeat(500) },
      { episode_number: 2, description: '本集' },
    ];
    const recap = buildSeriesRecap(long, 2);
    const firstLine = recap.split('\n')[0];
    expect(firstLine.length).toBeLessThanOrEqual('第1集:'.length + 220);
  });
});

describe('v12.244 buildRecapDirective', () => {
  it('非空前情 → 含承接纪律 + 本集内容标记', () => {
    const d = buildRecapDirective(buildSeriesRecap(EPS, 3));
    expect(d).toContain('前情提要');
    expect(d).toContain('承接纪律');
    expect(d).toContain('不重复已经发生过的情节');
    expect(d).toContain('本集内容');
    expect(d.endsWith('【本集内容】\n')).toBe(true); // 原 idea 会接在这后面
  });
});

describe('v12.244 已接进 series generate 与 pipeline 契约', () => {
  it('series generate route 调用了 buildRecapDirective', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'app', 'api', 'series', '[id]', 'generate', 'route.ts'), 'utf-8',
    );
    expect(src.includes('buildSeriesRecap') && src.includes('buildRecapDirective')).toBe(true);
    // 前情取自全部集 all,不是 targets(否则 force 重生单集时前情会缺)
    expect(/buildSeriesRecap\(all,/.test(src)).toBe(true);
  });

  it('CreatePipelineInput 有 seriesRecap 字段', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'create-pipeline.ts'), 'utf-8');
    expect(src.includes('seriesRecap')).toBe(true);
  });
});
