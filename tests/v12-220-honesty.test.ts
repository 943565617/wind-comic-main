/**
 * v12.220 — 诚实性止血防回潮锁。
 *
 * 尽调最大公关弹药是「承诺跑在能力前面」。本测试锁三条文案红线,防未来改动把过度承诺写回来:
 *   ①i18n 不得再宣称「Pro 商用许可可覆盖广告/品牌/电影发行」——素材版权归各生成引擎,青枫只提供编排工具。
 *   ②alertPayment 不得再写「支付即将上线」这类空承诺(支付尚未接入)。
 *   ③测试数徽章/CONTRIBUTING 不得停留在早已过时的旧数(2800+ 曾落后真实全量 ~270)。
 *
 * 属内容策略锁(针对交付到用户面前的字符串表 / 门面文档),故扫源文件是正当手段。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8');

describe('v12.220 i18n 无过度商用承诺', () => {
  const i18n = read('lib/i18n.ts');
  // 六语里曾出现的「广告/品牌/电影发行皆可商用」式承诺片段:
  const FORBIDDEN = [
    'ads, branding, film distribution',
    '广告/品牌/电影发行',
    '广告・ブランディング・映像配信',
    'реклама, брендинг, дистрибуция',
    '专业版和企业版用户可以将作品用于商业用途',
    '專業版和企業版使用者可以將作品用於商業用途',
  ];
  for (const s of FORBIDDEN) {
    it(`不含过度承诺片段: ${s.slice(0, 20)}…`, () => {
      expect(i18n.includes(s)).toBe(false);
    });
  }
  it('保留诚实口径「版权归属各生成引擎」(六语齐)', () => {
    const honest = [
      '归属各底层生成引擎',
      'belongs to the underlying engines',
      '歸屬各底層生成引擎',
      '各基盤エンジン',
      '각 기반 엔진',
      'принадлежат базовым движкам',
    ];
    for (const h of honest) expect(i18n.includes(h)).toBe(true);
  });
});

describe('v12.220 alertPayment 无空承诺', () => {
  const i18n = read('lib/i18n.ts');
  const FORBIDDEN = ['即将上线', 'coming soon', '近日公開', '곧 출시', 'скоро появится', '即將上線'];
  for (const s of FORBIDDEN) {
    it(`不含「即将上线」式空承诺: ${s}`, () => {
      expect(i18n.includes(s)).toBe(false);
    });
  }
});

describe('v12.220 测试数门面不停留旧值', () => {
  it('README 徽章不含早已过时的 2800+/3043', () => {
    const readme = read('README.md');
    expect(readme.includes('Tests-2800')).toBe(false);
    expect(readme.includes('Tests-3043')).toBe(false);
  });
  it('CONTRIBUTING 不停留在 2800+', () => {
    expect(read('CONTRIBUTING.md').includes('2800+')).toBe(false);
  });

  /**
   * v12.231(对抗复检补漏):v12.220 我声称"测试数三处统一"已堵,但只改了**徽章** ——
   * README 正文仍写 2802、Contributing 段仍写 2894/2894,中英双版皆然。
   * 对抗方一眼就抓出「同一文件里三个数打架」。锁扩到正文,别再只守徽章。
   */
  for (const f of ['README.md', 'README.zh-CN.md']) {
    it(`${f} 正文不含陈旧测试数 2802 / 2894`, () => {
      const src = read(f);
      expect(src.includes('2802')).toBe(false);
      expect(src.includes('2894')).toBe(false);
    });
  }

  /**
   * v12.233(对抗复检收尾):MARKETING-*.md 曾**冻在 v3.1.3 / 1150 tests** ——
   * 而它们是 README 首屏「🔥 Pitch / 营销文案」的公开链接,
   * 投资人点进去看到的是 12 个大版本前、测试数少 3 倍的数据。锁上防再冻。
   */
  for (const f of ['docs/MARKETING-en.md', 'docs/MARKETING-zh.md']) {
    it(`${f} 不停留在 v3.1.3 / 1150 tests`, () => {
      const src = read(f);
      expect(src.includes('v3.1.3')).toBe(false);
      expect(/\b1150\b/.test(src)).toBe(false);
    });
  }
});
