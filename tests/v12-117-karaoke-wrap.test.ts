/**
 * v12.117 — karaoke 长行折行:显示宽/断点选择/kf 时长守恒/短行不折。
 */
import { describe, it, expect } from 'vitest';
import { tokenDisplayWidth, wrapKaraokeTokens, buildKaraokeLineText, tokenizeForKaraoke, buildKaraokeAss } from '@/lib/ass-karaoke';

describe('v12.117 · karaoke 折行', () => {
  it('tokenDisplayWidth:CJK=1,ASCII=0.5', () => {
    expect(tokenDisplayWidth('好')).toBe(1);
    expect(tokenDisplayWidth('ok')).toBe(1);
    expect(tokenDisplayWidth('AI芯片')).toBe(3);
  });

  it('短行不折;超宽折 2 行且尽量均衡', () => {
    const short = tokenizeForKaraoke('三秒开机');
    expect(wrapKaraokeTokens(short, 6)).toEqual([short]);
    const long = tokenizeForKaraoke('这款降噪耳机让你通勤路上瞬间安静下来');
    const rows = wrapKaraokeTokens(long, 10);
    expect(rows.length).toBe(2);
    const w = (r: string[]) => r.reduce((a, t) => a + tokenDisplayWidth(t), 0);
    expect(Math.abs(w(rows[0]) - w(rows[1]))).toBeLessThanOrEqual(2);
  });

  it('标点后断点优先', () => {
    const tokens = tokenizeForKaraoke('真的太好用了,收藏加购不亏');
    const rows = wrapKaraokeTokens(tokens, 9);
    expect(rows[0][rows[0].length - 1]).toBe(',');
  });

  it('折行后 \\N 连接,kf 总厘秒守恒', () => {
    const body = buildKaraokeLineText('这款降噪耳机让你通勤路上瞬间安静', 3, 8);
    expect(body).toContain('\\N');
    const total = [...body.matchAll(/\\kf(\d+)/g)].reduce((a, m) => a + Number(m[1]), 0);
    expect(total).toBe(300);
  });

  it('buildKaraokeAss 长台词整体链路含折行', () => {
    const ass = buildKaraokeAss(
      [{ text: '这款降噪耳机让你通勤路上瞬间安静下来真的绝', startSec: 0, durSec: 4 }],
      { w: 720, h: 1280, fontName: 'PingFang SC', vertical: true },
    );
    expect(ass).toContain('\\N');
  });
});

describe('v12.117 · 超长行内联缩字号', () => {
  it('折 2 行后仍超宽 → 行内 {\\fs} 缩;短句不受影响', async () => {
    const { buildKaraokeAss } = await import('@/lib/ass-karaoke');
    const ass = buildKaraokeAss([
      { text: '这款降噪耳机让你通勤路上瞬间安静下来真的绝了', startSec: 0, durSec: 3 },
      { text: '三秒开机', startSec: 3, durSec: 1.5 },
    ], { w: 720, h: 1280, fontName: 'PingFang SC', vertical: true });
    const dialogues = ass.split('\n').filter((l) => l.startsWith('Dialogue'));
    expect(dialogues[0]).toMatch(/\{\\fs\d+\}/);
    expect(dialogues[1]).not.toMatch(/\{\\fs\d+\}/);
  });
});
