/**
 * Sprint B.4 — 片头/片尾 filter 生成器单测
 *
 * 不打 ffmpeg 二进制(那需要真实文件 + 真 codec), 只锁住 filter 字符串语义:
 *   · intro 有 cover → scale + crop + drawbox 暗化 + 标题淡入 + brand
 *   · intro 无 cover → 退到 color 黑底
 *   · outro 默认包含 brand + title + character roster (≤6)
 *   · 文本中的 ' / : / % / \n 必须转义
 *   · duration 常量与 ROADMAP 决策值锁住
 */

import { describe, it, expect } from 'vitest';
import {
  buildIntroFilters,
  buildOutroFilters,
  escapeDrawtextText,
  INTRO_DURATION_S,
  OUTRO_DURATION_S,
  INTRO_OUTRO_RESOLUTION,
} from '@/services/intro-outro';

describe('escapeDrawtextText (Sprint B.4)', () => {
  it('把危险字符替换成安全字形(v12.258:不再反斜杠转义,避免单引号 filter 值破裂/％{}展开)', () => {
    const out = escapeDrawtextText("8:30 PM — it's 50% done");
    expect(out).toContain('8:30');   // 冒号在单引号内安全,保持原样
    expect(out).toContain('it’s');   // 单引号 → 右单引号
    expect(out).toContain('50％');   // 百分号 → 全角(杜绝 %{...} 展开)
    // 绝不残留会破坏 filtergraph 的裸字符
    expect(out).not.toContain("'");
    expect(escapeDrawtextText('a%{pts}b{x}')).toMatch(/％｛pts｝b｛x｝/);
  });

  it('replaces newlines with single space', () => {
    expect(escapeDrawtextText('line1\nline2\r\nline3')).toBe('line1 line2 line3');
  });
});

describe('buildIntroFilters (Sprint B.4)', () => {
  it('with cover image — uses scale+crop+drawbox dim layer', () => {
    const filters = buildIntroFilters({
      title: '雨夜重逢',
      brand: 'Wind Comic',
      hasCover: true,
    });
    const joined = filters.join('\n');
    expect(joined).toContain('scale=1920:1080');
    expect(joined).toContain('crop=1920:1080');
    expect(joined).toContain('drawbox');
    expect(joined).toContain('black@0.45'); // 暗化遮罩
    expect(joined).toContain("text='雨夜重逢'");
    expect(joined).toContain("text='by Wind Comic'");
    // 标题淡入表达式
    expect(joined).toContain("alpha='if(lt(t\\,0.6)\\,t/0.6\\,1)'");
    // 静音音轨
    expect(joined).toContain('anullsrc');
    // [vout] [aout] 必须存在
    expect(joined).toContain('[vout]');
    expect(joined).toContain('[aout]');
  });

  it('without cover — uses color=black source', () => {
    const filters = buildIntroFilters({
      title: 'X',
      brand: 'Wind Comic',
      hasCover: false,
    });
    const joined = filters.join('\n');
    expect(joined).toContain('color=c=black');
    expect(joined).not.toContain('scale=1920:1080'); // 没有 input 视频, 不需要 scale
  });

  it('uses custom fontFile when provided', () => {
    const filters = buildIntroFilters({
      title: 'X',
      brand: 'Y',
      hasCover: false,
      fontFile: '/fonts/cool.ttf',
    });
    expect(filters.join('\n')).toContain("fontfile='/fonts/cool.ttf'");
  });

  it('respects custom duration', () => {
    const filters = buildIntroFilters({
      title: 'X',
      brand: 'Y',
      hasCover: false,
      duration: 3.0,
    });
    const joined = filters.join('\n');
    expect(joined).toContain(':d=3'); // color source 时长
    expect(joined).toContain('atrim=0:3');
  });
});

describe('buildOutroFilters (Sprint B.4)', () => {
  it('renders brand + title + roster (3 chars)', () => {
    const filters = buildOutroFilters({
      title: '雨夜重逢',
      brand: 'Wind Comic',
      characters: [
        { name: '李长安' },
        { name: '柳如烟' },
        { name: '混混 1' },
      ],
    });
    const joined = filters.join('\n');
    expect(joined).toContain("text='Made by Wind Comic'");
    expect(joined).toContain("text='「雨夜重逢」'");
    expect(joined).toContain('李长安');
    expect(joined).toContain('柳如烟');
    expect(joined).toContain('混混 1');
    expect(joined).toContain('[vout]');
    expect(joined).toContain('[aout]');
  });

  it('caps roster to first 6 characters', () => {
    const tenChars = Array.from({ length: 10 }, (_, i) => ({ name: `角色${i + 1}` }));
    const filters = buildOutroFilters({
      title: 'X',
      brand: 'Y',
      characters: tenChars,
    });
    const joined = filters.join('\n');
    expect(joined).toContain('角色1');
    expect(joined).toContain('角色6');
    expect(joined).not.toContain('角色7');
  });

  it('skips roster line when no characters provided', () => {
    const filters = buildOutroFilters({
      title: 'X',
      brand: 'Y',
      characters: [],
    });
    const joined = filters.join('\n');
    // brand + title yes, roster no
    expect(joined).toContain("text='Made by Y'");
    expect(joined).not.toMatch(/角色|·\s+·/);
  });
});

describe('Sprint B.4 design constants', () => {
  it('INTRO_DURATION_S = 1.5 (ROADMAP §B.4)', () => {
    expect(INTRO_DURATION_S).toBe(1.5);
  });

  it('OUTRO_DURATION_S = 2.0 (ROADMAP §B.4)', () => {
    expect(OUTRO_DURATION_S).toBe(2.0);
  });

  it('output resolution is 1920x1080', () => {
    expect(INTRO_OUTRO_RESOLUTION.width).toBe(1920);
    expect(INTRO_OUTRO_RESOLUTION.height).toBe(1080);
  });
});
