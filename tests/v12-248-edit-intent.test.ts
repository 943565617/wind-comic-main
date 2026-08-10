/**
 * v12.248 — 对话式编辑:自然语言 → 编辑意图。
 *
 * 跟上 Gemini Omni Flash 的「对话式编辑」范式,但落在编排层(映射到既有 recompose/regenerate-shot)。
 * 纯函数只解析不执行 —— 破坏性操作留给前端确认后调既有端点。
 */
import { describe, expect, it } from 'vitest';
import { parseEditIntent, extractShotNumbers, describeIntents, hasDestructiveIntent } from '@/lib/edit-intent';

describe('v12.248 extractShotNumbers', () => {
  it('多种镜号写法', () => {
    expect(extractShotNumbers('删掉第3镜')).toEqual([3]);
    expect(extractShotNumbers('第 2 个镜头改暗')).toEqual([2]);
    expect(extractShotNumbers('shot 5 重画')).toEqual([5]);
    expect(extractShotNumbers('镜头4太亮')).toEqual([4]);
  });
  it('多镜号去重升序', () => {
    expect(extractShotNumbers('删掉第3镜和第1镜,还有镜头3')).toEqual([1, 3]);
  });
  it('无镜号 → 空', () => {
    expect(extractShotNumbers('改成竖屏')).toEqual([]);
  });
});

describe('v12.248 parseEditIntent 单意图', () => {
  it('字幕风格', () => {
    expect(parseEditIntent('换成卡点字幕').intents).toEqual([{ op: 'setCaptionStyle', value: 'karaoke' }]);
    expect(parseEditIntent('字幕用醒目大字').intents).toEqual([{ op: 'setCaptionStyle', value: 'bold' }]);
  });
  it('平台安全区', () => {
    expect(parseEditIntent('适配抖音').intents).toContainEqual({ op: 'setPlatform', value: 'douyin' });
    expect(parseEditIntent('发小红书').intents).toContainEqual({ op: 'setPlatform', value: 'xiaohongshu' });
  });
  it('画幅', () => {
    expect(parseEditIntent('改成竖屏').intents).toContainEqual({ op: 'setAspect', value: '9:16' });
    expect(parseEditIntent('要横屏 16:9').intents).toContainEqual({ op: 'setAspect', value: '16:9' });
  });
  it('节奏', () => {
    expect(parseEditIntent('节奏快一点').intents).toContainEqual({ op: 'setPace', value: 'fast' });
    expect(parseEditIntent('慢一点抒情').intents).toContainEqual({ op: 'setPace', value: 'slow' });
  });
  it('重配音', () => {
    expect(parseEditIntent('重新配音').intents).toEqual([{ op: 'regenVoiceover' }]);
  });
  it('删镜', () => {
    expect(parseEditIntent('删掉第3镜').intents).toEqual([{ op: 'dropShot', shotNumber: 3 }]);
  });
  it('重生某镜带 note', () => {
    const r = parseEditIntent('第2镜调暗一点');
    expect(r.intents[0]).toMatchObject({ op: 'regenShot', shotNumber: 2 });
    expect((r.intents[0] as any).note).toContain('第2镜');
  });
});

describe('v12.248 parseEditIntent 复合指令', () => {
  it('一句多意图:删镜 + 竖屏 + 卡点字幕 + 抖音', () => {
    const r = parseEditIntent('删掉第3镜,改成竖屏卡点字幕,适配抖音');
    expect(r.intents).toContainEqual({ op: 'dropShot', shotNumber: 3 });
    expect(r.intents).toContainEqual({ op: 'setAspect', value: '9:16' });
    expect(r.intents).toContainEqual({ op: 'setCaptionStyle', value: 'karaoke' });
    expect(r.intents).toContainEqual({ op: 'setPlatform', value: 'douyin' });
    expect(r.unmatched).toBe(false);
  });
  it('删镜与重生镜互斥:同一句是「删」不误判成「重生」', () => {
    const r = parseEditIntent('删掉第3镜');
    expect(r.intents.every((i) => i.op !== 'regenShot')).toBe(true);
  });
  it('听不懂 → unmatched', () => {
    const r = parseEditIntent('今天天气不错');
    expect(r.intents).toEqual([]);
    expect(r.unmatched).toBe(true);
  });
  it('空输入不抛错', () => {
    expect(parseEditIntent('').unmatched).toBe(true);
    expect(parseEditIntent(undefined as any).unmatched).toBe(true);
  });
});

describe('v12.248 对抗复检修复(recheck)', () => {
  // #1 low:小红书英文名 RED 太短,\b 只锚右侧 → 撞 alfred/hatred。收紧后裸 red 不再误判平台。
  it('「alfred」等含 red 的词不误判成小红书平台', () => {
    const r = parseEditIntent('alfred 同款风格卡点字幕');
    expect(r.intents).not.toContainEqual({ op: 'setPlatform', value: 'xiaohongshu' });
    expect(r.intents).toContainEqual({ op: 'setCaptionStyle', value: 'karaoke' });
  });
  it('rednote / 小红书 仍能正常识别', () => {
    expect(parseEditIntent('导出到 rednote').intents).toContainEqual({ op: 'setPlatform', value: 'xiaohongshu' });
    expect(parseEditIntent('发小红书').intents).toContainEqual({ op: 'setPlatform', value: 'xiaohongshu' });
  });

  // #2 high:否定的破坏性指令绝不能被反向执行。
  it('「不要删掉第3镜」不发出删除意图(否定守卫)', () => {
    const r = parseEditIntent('不要删掉第3镜');
    expect(r.intents.some((i) => i.op === 'dropShot')).toBe(false);
    expect(hasDestructiveIntent(r.intents)).toBe(false);
  });
  it('「别删第2镜」「不要重新配音」同样被否定', () => {
    expect(parseEditIntent('别删第2镜').intents.some((i) => i.op === 'dropShot')).toBe(false);
    expect(parseEditIntent('不要重新配音').intents.some((i) => i.op === 'regenVoiceover')).toBe(false);
  });
  it('否定词在动词之后不误伤:「第2镜调暗别太暗」仍重生第2镜', () => {
    const r = parseEditIntent('第2镜调暗别太暗');
    expect(r.intents).toContainEqual(expect.objectContaining({ op: 'regenShot', shotNumber: 2 }));
  });

  // #3 high:混合指令里每镜用自己分句的动词,不被全局 wantsDrop 串。
  it('「删掉第1镜,第2镜调暗一点」→ 第1镜删、第2镜重生(不误删第2镜)', () => {
    const r = parseEditIntent('删掉第1镜,第2镜调暗一点');
    expect(r.intents).toContainEqual({ op: 'dropShot', shotNumber: 1 });
    expect(r.intents).toContainEqual(expect.objectContaining({ op: 'regenShot', shotNumber: 2 }));
    expect(r.intents).not.toContainEqual({ op: 'dropShot', shotNumber: 2 });
  });
});

describe('v12.248 describeIntents / hasDestructiveIntent', () => {
  it('翻成人话', () => {
    const desc = describeIntents([
      { op: 'dropShot', shotNumber: 3 },
      { op: 'setAspect', value: '9:16' },
    ]);
    expect(desc[0]).toContain('删除第 3 镜');
    expect(desc[1]).toContain('竖屏');
  });
  it('识别破坏性操作(需二次确认)', () => {
    expect(hasDestructiveIntent([{ op: 'setAspect', value: '9:16' }])).toBe(false);
    expect(hasDestructiveIntent([{ op: 'dropShot', shotNumber: 1 }])).toBe(true);
    expect(hasDestructiveIntent([{ op: 'regenVoiceover' }])).toBe(true);
  });
});
