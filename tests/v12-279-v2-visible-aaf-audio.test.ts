/**
 * v12.279 — 还两笔自己欠的账(证据化审计抓出来的)。
 *
 * ① **节奏审计 v2 对用户完全不可见**:v12.275 做了 v2 诊断、v12.278 让它落库并导进 NLE,
 *    但 `components/project/pacing-chart.tsx` 的**本地 `PacingReport` 接口没有 `v2` 字段**
 *    —— 算了、存了、导出去了,唯独自家 UI 一直不显示。
 * ② **AAF 缺音轨**:v12.277 给 EDL/FCPXML 补了配音与 BGM,**AAF 漏了同步**,
 *    同一份成片导 EDL 有声、导 AAF 是一条哑视频轨。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { buildAafComposition, buildAafXml, buildAAF, isCfb } from '@/lib/aaf-export';
import type { EdlShot, EdlAudio } from '@/lib/edl-export';

const FPS = 24;
const SHOTS: EdlShot[] = [
  { name: 'Shot 01', durationS: 3 },
  { name: 'Shot 02', durationS: 4 },
];
const AUDIO: EdlAudio[] = [
  { name: 'VO Shot 01 — 林晚', sourceUrl: 'https://x/vo1.mp3', startS: 0, durationS: 3, kind: 'vo' },
  { name: 'VO Shot 02 — 顾行', sourceUrl: 'https://x/vo2.mp3', startS: 3, durationS: 4, kind: 'vo' },
  { name: 'BGM', sourceUrl: 'https://x/bgm.mp3', startS: 0, durationS: 7, kind: 'bgm' },
];

describe('v12.279 · ① 节奏审计 v2 必须在 UI 上可见', () => {
  const src = fs.readFileSync('components/project/pacing-chart.tsx', 'utf-8');

  it('组件接口含 v2 字段(此前完全没有,导致算了也不显示)', () => {
    expect(src).toMatch(/v2\?:\s*PacingV2Shape/);
    expect(src).toContain('PacingV2Shape');
  });

  it('四项诊断都被渲染:曲线形状 / 拖沓段 / 开场密度 / 时长节奏', () => {
    expect(src).toContain('v2.shape');
    expect(src).toContain('v2.dragSegments');
    expect(src).toContain('v2.opening');
    expect(src).toContain('v2.durationRhythm');
  });

  it('拖沓段以镜号区间呈现(而不是只报一个平均分)', () => {
    expect(src).toMatch(/S\{d\.fromShot\}–\{d\.toShot\}/);
  });

  it('曲线形状用中文可读标签(escalating 等英文枚举不直接示人)', () => {
    expect(src).toContain('层层递进');
    expect(src).toContain('高开低走');
  });

  it('无 v2 时整块不渲染(老项目零回归)', () => {
    expect(src).toMatch(/\{v2 && \(/);
  });
});

describe('v12.279 · ② AAF 必须与 EDL/FCPXML 一样带音轨', () => {
  it('组合模型分出 A1 配音与 A2 配乐', () => {
    const comp = buildAafComposition(SHOTS, FPS, 'T', AUDIO);
    expect(comp.audioClips).toHaveLength(2);
    expect(comp.bgmClips).toHaveLength(1);
  });

  it('音频按成片时间轴起点排布(不是首尾相接)', () => {
    const comp = buildAafComposition(SHOTS, FPS, 'T', AUDIO);
    // 第二段配音从 3s 起 = 72 帧
    expect(comp.audioClips![1].startFrame).toBe(3 * FPS);
    expect(comp.audioClips![1].lengthFrame).toBe(4 * FPS);
  });

  it('XML 产出 A1/A2 两条 Sound 轨,且带素材地址与说话人', () => {
    const xml = buildAafXml(buildAafComposition(SHOTS, FPS, 'T', AUDIO));
    expect(xml).toContain('aaf:track="A1" aaf:mediaKind="Sound"');
    expect(xml).toContain('aaf:track="A2" aaf:mediaKind="Sound"');
    expect(xml).toContain('https://x/vo1.mp3');
    expect(xml).toContain('VO Shot 02 — 顾行');
  });

  it('零回归:不传音轨时无 Sound 轨,视频轨与旧版同形', () => {
    const xml = buildAafXml(buildAafComposition(SHOTS, FPS, 'T'));
    expect(xml).not.toContain('mediaKind="Sound"');
    expect(xml).toContain('aaf:track="V1" aaf:mediaKind="Picture"');
  });

  it('带音轨后仍是合法 CFB 二进制容器(没把容器写坏)', () => {
    const buf = buildAAF(SHOTS, FPS, 'T', AUDIO);
    expect(isCfb(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(4096);
  });

  it('AAF 路由已接线(与 export-edl 同源组装)', () => {
    const route = fs.readFileSync('app/api/projects/[id]/export-aaf/route.ts', 'utf-8');
    expect(route).toContain('voiceoverClips');
    expect(route).toContain('musicUrl');
    expect(route).toContain('buildAAF(shots, fps, title, audio)');
  });
});
