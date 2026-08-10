/**
 * v12.281 — 结构化角色 DNA 注入视频 prompt(此前只注入分镜图)。
 *
 * 病根:`injectDnaIntoPrompt` 全仓**只在 runStoryboardRenderer 里调用一次**。
 * 于是同一部片:
 *   · 分镜图 prompt 拿的是 vision LLM 从**实际生成的三视图**抽出的 8 维签名
 *     (眼型/颌型/鼻型/嘴型/发型/发色/肤色/标志服饰);
 *   · 视频 prompt 只拿到剧本里的**自由文本外观**(如「青年男性,冷峻」)。
 * 按"实际长出来的样子"渲分镜、按"剧本写的"生视频 —— 依赖文本 prompt 的引擎必然跨镜漂脸。
 *
 * ⚠️ 本版最容易改错的地方:**不能无脑全加**。v12.9.1 实测过,MiniMax S2V 已从
 * subject_reference 提取身份,prompt 再重复外观**反而与参考图冲突致漂移**。
 * 故 DNA 必须与 charDescSegment 同待遇 —— 一起进 enhancedPrompt,一起从 S2V 版剥掉。
 * 下面第二组就是锁这条。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { injectDnaIntoPrompt } from '@/lib/character-dna';

const SRC = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');

const mkDna = (name: string, block: string): any => ({
  characterName: name, sourceImageUrl: 'https://x/t.png', signature: {}, promptBlock: block,
});

describe('v12.281 · DNA 注入纯函数(既有,回归)', () => {
  it('按镜头角色取 DNA 块并拼到 prompt 尾部', () => {
    const map = new Map<string, any>([['林晚', mkDna('林晚', 'almond upturned eyes, soft oval jaw')]]);
    const out = injectDnaIntoPrompt('a girl by the window', ['林晚'], map);
    expect(out).toContain('a girl by the window');
    expect(out).toContain('almond upturned eyes');
  });

  it('同一 DNA 块不重复拼(多角色同签名时)', () => {
    const blk = 'deep black hair';
    const map = new Map<string, any>([['A', mkDna('A', blk)], ['B', mkDna('B', blk)]]);
    const out = injectDnaIntoPrompt('base', ['A', 'B'], map);
    expect(out.match(/deep black hair/g)).toHaveLength(1);
  });

  it('无角色 / 无 DNA / 空 map → 原样返回(不炸不加噪声)', () => {
    const map = new Map<string, any>([['A', mkDna('A', 'x')]]);
    expect(injectDnaIntoPrompt('base', [], map)).toBe('base');
    expect(injectDnaIntoPrompt('base', undefined, map)).toBe('base');
    expect(injectDnaIntoPrompt('base', ['A'], new Map())).toBe('base');
    expect(injectDnaIntoPrompt('base', ['不存在'], map)).toBe('base');
  });
});

describe('v12.281 · 视频阶段接线(此前只有分镜阶段)', () => {
  it('injectDnaIntoPrompt 现在有两处调用:分镜 + 视频', () => {
    const calls = (SRC.match(/injectDnaIntoPrompt\(/g) || []).length;
    expect(calls, '应为分镜与视频各一处').toBeGreaterThanOrEqual(2);
  });

  it('视频阶段读的是同一份 characterDnaMap(不是另建一份)', () => {
    const vidIdx = SRC.indexOf('let dnaSegment');
    expect(vidIdx, '应有视频阶段的 dnaSegment 构造').toBeGreaterThan(0);
    const block = SRC.slice(vidIdx, vidIdx + 700);
    expect(block).toContain('this.characterDnaMap');
    expect(block).toContain('shot?.characters');
  });

  it('注入失败不阻塞出片(try/catch + 非阻塞告警)', () => {
    const vidIdx = SRC.indexOf('let dnaSegment');
    const block = SRC.slice(vidIdx, vidIdx + 900);
    expect(block).toContain('catch');
    expect(block).toContain('非阻塞');
  });
});

describe('v12.281 · ⚠️ S2V 通道必须剥离 DNA(v12.9.1 实测的坑)', () => {
  it('S2V 版在剥 charDescSegment 之外,也剥 dnaSegment', () => {
    const i = SRC.indexOf('let minimaxS2vPrompt');
    expect(i, '应有 S2V 去外观版构造').toBeGreaterThan(0);
    const block = SRC.slice(i, i + 500);
    expect(block).toContain('dnaSegment');
    expect(block).toMatch(/minimaxS2vPrompt\.split\(dnaSegment\)/);
  });

  it('行为模拟:S2V 版应同时不含外观段与 DNA 段', () => {
    // 复刻生产里的剥离逻辑,验证两段都能被干净移除
    const charDescSegment = '. Character: 林晚: 青年女性,冷峻';
    const dnaSegment = '. almond upturned eyes, soft oval jaw';
    let enhanced = 'slow push in on 85mm, MCU';
    enhanced += charDescSegment;
    enhanced += dnaSegment;

    let s2v = enhanced.includes(charDescSegment) ? enhanced.split(charDescSegment).join('') : enhanced;
    if (dnaSegment && s2v.includes(dnaSegment)) s2v = s2v.split(dnaSegment).join('');

    expect(enhanced).toContain('almond upturned eyes');   // 完整版有 DNA
    expect(s2v).not.toContain('almond upturned eyes');    // S2V 版没有
    expect(s2v).not.toContain('青年女性');                 // 外观段也没有
    expect(s2v).toBe('slow push in on 85mm, MCU');        // 只剩镜头语言
  });

  it('保留 v12.9.1 的原因说明(防后人误以为是冗余代码删掉)', () => {
    const i = SRC.indexOf('let minimaxS2vPrompt');
    // 窗口取大些:v12.281 在其上方插了整段说明,原 600 字符不足以覆盖到 v12.9.1 的原因注释
    const block = SRC.slice(Math.max(0, i - 2000), i + 300);
    expect(block).toContain('subject_reference');
    expect(block).toMatch(/冲突|漂移/);
  });
});
