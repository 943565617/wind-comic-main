/**
 * v12.148 — 草图锁全片实测暴露的三修:
 *   A) Writer 截断 JSON 救回(Tier 3.8,真实 23KB dump 回归)
 *   B) MiniMax Fast i2v-only 适配(first_frame_image)
 *   C) seedream i2i 画幅守门(漂移检测纯函数 + 接线)
 */
import { describe, it, expect } from 'vitest';
import { robustJsonParse, completeTruncatedJson } from '@/lib/polish-json';
import { aspectToRatio, aspectDrifted } from '@/lib/image-aspect-guard';
import fs from 'fs';

describe('修A · 截断 JSON 救回', () => {
  it('真实 23KB Writer 截断 dump:救回完整前缀(title/shots)而非 null', () => {
    const raw = fs.readFileSync('tests/fixtures/llm-writer-truncated-23kb.txt', 'utf-8');
    const v = robustJsonParse(raw);
    expect(v).toBeTruthy();
    expect(v.title).toBe('便利店的第七夜');
    expect(Array.isArray(v.shots)).toBe(true);
    expect(v.shots.length).toBeGreaterThanOrEqual(1); // 至少救回完整的前几镜
    expect(v.shots[0].shotNumber).toBe(1);
  });
  it('合成用例:字符串中间截断/数组元素截断都能回退到安全点', () => {
    const a = completeTruncatedJson('{"a": [{"x": 1}, {"x": 2}, {"x": 3, "y": "half');
    expect(JSON.parse(a!)).toEqual({ a: [{ x: 1 }, { x: 2 }, { x: 3 }] }); // 残缺字段 y 丢弃,x:3 保住
    const b = completeTruncatedJson('{"shots": [{"n": 1, "beats": ["a", "b"]}, {"n": 2, "beats": ["c"');
    expect(JSON.parse(b!).shots[0]).toEqual({ n: 1, beats: ['a', 'b'] });
    expect(completeTruncatedJson('{"done": true}')).toBeNull(); // 完整 JSON 不归本级管
  });
  it('v12.169:日语 24KB 真 dump(截断+带正号数字数组)救回', () => {
    const raw = fs.readFileSync('tests/fixtures/llm-writer-truncated-ja-24kb.txt', 'utf-8');
    const v = robustJsonParse(raw);
    expect(v).toBeTruthy();
    expect(v.title).toBe('静寂の旅路');
    expect(Array.isArray(v.shots)).toBe(true);
    expect(v.shots.length).toBeGreaterThanOrEqual(1);
  });
  it('v12.169:字符串外 +数字 剥正号;字符串内的 + 不动', () => {
    expect(robustJsonParse('{"curve": [-4, -3, +3, +5, +8], "t": "a+b"}')).toEqual({ curve: [-4, -3, 3, 5, 8], t: 'a+b' });
  });
  it('Tier 3.7:中文正文里被 dequote 产生的裸引号能转义救回', () => {
    const bad = '{"synopsis": "他抬头说"你是谁",然后转身", "n": 1}';
    const v = robustJsonParse(bad);
    expect(v?.n).toBe(1);
    expect(v?.synopsis).toContain('你是谁');
  });
});

describe('修B · MiniMax Fast i2v', () => {
  it('generateVideoFast 支持 firstFrameImage 且两个调用点都带首帧', () => {
    const svc = fs.readFileSync('services/minimax.service.ts', 'utf-8');
    expect(svc).toContain('firstFrameImage?: string');
    expect(svc).toContain('first_frame_image: options.firstFrameImage');
    expect(svc).toContain('firstFrameImage: imageUrl || undefined'); // 标准版配额兜底透传
    const orch = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    expect(orch).toContain('firstFrameImage: retryFirstFrame || undefined'); // Pass-B 带 Pass-A 首帧
  });
});

describe('修C · 画幅守门', () => {
  it('漂移检测:2848x1600 对 9:16 是漂移;720x1280 不是;容差内放行', () => {
    expect(aspectToRatio('9:16')).toBeCloseTo(0.5625);
    expect(aspectDrifted(2848, 1600, '9:16')).toBe(true);   // 实测事故尺寸
    expect(aspectDrifted(720, 1280, '9:16')).toBe(false);
    expect(aspectDrifted(704, 1280, '9:16')).toBe(false);   // ~2% 容差内
    expect(aspectDrifted(1280, 720, '16:9')).toBe(false);
    expect(aspectDrifted(0, 0, '9:16')).toBe(false);        // 坏输入不误裁
  });
  it('接线锁:seedream i2i 产出过 ensureImageAspect', () => {
    const orch = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    expect(orch).toContain('ensureImageAspect(u, opts?.aspectRatio');
  });
});
