/**
 * v12.146 — 情绪节拍→运镜自动标注(P1-④):规则纯函数 + 只补缺失 + 接线锁。
 */
import { describe, it, expect } from 'vitest';
import { suggestCameraMove, annotateCameraByEmotion } from '@/lib/emotion-camera';
import { normalizeCameraMovement } from '@/lib/shot-enums';
import fs from 'fs';

describe('v12.146 · suggestCameraMove 规则', () => {
  it('优先级:hook > 关键词 > 情绪温度 > 景别', () => {
    expect(suggestCameraMove({ beatFunction: 'hook', emotionTemperature: 8 })!.move).toBe('push-in');
    expect(suggestCameraMove({ beats: [{ mood: '紧张', action: '巷内追逐' }], emotionTemperature: 8 })!.move).toBe('handheld');
    expect(suggestCameraMove({ emotionTemperature: -8 })!.move).toBe('handheld');
    expect(suggestCameraMove({ emotionTemperature: -5 })!.move).toBe('push-in');
    expect(suggestCameraMove({ emotionTemperature: 8 })!.move).toBe('orbit');
    expect(suggestCameraMove({ emotionTemperature: 5 })!.move).toBe('crane-up');
    expect(suggestCameraMove({ shotSize: 'wide' })!.move).toBe('dolly-in');
    expect(suggestCameraMove({ shotSize: 'CU' })!.move).toBe('static');
    expect(suggestCameraMove({ shotSize: '特写' })!.move).toBe('static');   // 中文过 normalizeShotSize
    expect(suggestCameraMove({ shotSize: '全景' })!.move).toBe('dolly-in');
    expect(suggestCameraMove({})).toBeNull(); // 无信号不硬标
  });
  it('产出全部是合法枚举(下游 v12.142 归一必命中)', () => {
    const cases = [
      { beatFunction: 'hook' }, { emotionTemperature: -8 }, { emotionTemperature: 5 },
      { shotSize: 'ELS' }, { beats: [{ mood: '离别' }] }, { beats: [{ action: 'reveal the truth' }] },
    ];
    for (const c of cases) {
      const s = suggestCameraMove(c as any);
      expect(s && normalizeCameraMovement(s.move)).toBe(s!.move);
    }
  });
});

describe('v12.146 · annotateCameraByEmotion 只补缺失', () => {
  it('已有运镜(含归一失败的自由文本)保留;空的才补;备注可读', () => {
    const shots = [
      { shotNumber: 1, cameraMovement: '缓慢推近', emotionTemperature: -8 },   // 已设计 → 不动
      { shotNumber: 2, cameraMovement: '', emotionTemperature: -8 },           // 空 → handheld
      { shotNumber: 3, emotionTemperature: 5 },                                 // 缺字段 → crane-up
      { shotNumber: 4, cameraMovement: '   ' },                                 // 空白且无信号 → 不动
    ];
    const notes = annotateCameraByEmotion(shots as any);
    expect(shots[0].cameraMovement).toBe('缓慢推近');
    expect(shots[1].cameraMovement).toBe('handheld');
    expect((shots[2] as any).cameraMovement).toBe('crane-up');
    expect(notes.length).toBe(2);
    expect(notes[0]).toContain('S2');
  });
  it('接线锁:startProduction 在 runWriter 后调用,且尊重全局运镜默认', () => {
    const src = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    expect(src).toContain('annotateCameraByEmotion');
    expect(src).toMatch(/if \(!this\.cameraDefault && Array\.isArray/);
  });
});
