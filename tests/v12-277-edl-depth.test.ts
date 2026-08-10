/**
 * v12.277 — 剪辑线导出对齐成片真实时间轴 + 补音轨与转场。
 *
 * 立项依据:EDL/AAF 导出是「全部已查竞品(含开源 ViMax)的共同空白」,是本项目最实的护城河之一。
 * 但盘点下来,我们自己这块既**浅**又**错**:
 *   ① 错:路由只读 script 的 `s.duration`(**设计时长**),而成片时长会被卡点吸附与逐镜变速改写
 *      → 导出的时间码与实际 mp4 对不上,且越往后偏得越多(与之前修的音画不同步同源:设计值 vs 终值);
 *   ② 浅:EDL 只有一条 **V 轨、全部 C(硬切)** —— 逐角色配音、BGM、以及管线设计的转场,
 *      剪辑师导入后**全部丢失**,等于把管线一半的活儿扔了;FCPXML 连 `<audio>` 段都没有。
 */
import { describe, it, expect } from 'vitest';
import { buildEDL, buildFCPXML, isDissolveTransition, secondsToTimecode, type EdlShot, type EdlAudio } from '@/lib/edl-export';

const FPS = 24;

describe('v12.277 · 转场判定', () => {
  it('cut / flash-cut / continuous / 空 都算硬切,其余按溶解', () => {
    for (const t of ['cut', 'flash-cut', 'continuous', '', undefined, null]) {
      expect(isDissolveTransition(t as any), `${t} 应为硬切`).toBe(false);
    }
    for (const t of ['dissolve', 'fade', 'wipeleft', 'smoothup']) {
      expect(isDissolveTransition(t), `${t} 应为溶解`).toBe(true);
    }
  });
});

describe('v12.277 · EDL 转场事件(此前一律写 C,转场设计全丢)', () => {
  const shots: EdlShot[] = [
    { name: 'Shot 01', durationS: 3, transition: 'cut' },
    { name: 'Shot 02', durationS: 4, transition: 'dissolve', transitionDurationS: 0.5 },
  ];

  it('溶解镜产出 D 事件 + 转场帧数 + EFFECT NAME', () => {
    const edl = buildEDL(shots, FPS);
    expect(edl).toContain('CROSS DISSOLVE');
    // D 事件带三位转场帧数(0.5s × 24fps = 12 帧)
    expect(edl).toMatch(/V\s+D\s+012\s/);
  });

  it('硬切镜仍是 C 事件(零回归)', () => {
    const edl = buildEDL([{ name: 'Shot 01', durationS: 3, transition: 'cut' }], FPS);
    expect(edl).toMatch(/V\s+C\s/);
    expect(edl).not.toContain('CROSS DISSOLVE');
  });

  it('事件号连续递增(D 事件多占一条,不能重号)', () => {
    const edl = buildEDL(shots, FPS);
    const evts = [...edl.matchAll(/^(\d{3})\s+AX/gm)].map((m) => Number(m[1]));
    expect(evts).toEqual(evts.map((_, i) => i + 1));
  });
});

describe('v12.277 · EDL 音轨(此前只有视频轨)', () => {
  const shots: EdlShot[] = [{ name: 'Shot 01', durationS: 3 }, { name: 'Shot 02', durationS: 4 }];
  const audio: EdlAudio[] = [
    { name: 'VO Shot 01 — 林晚', sourceUrl: 'https://x/vo1.mp3', startS: 0, durationS: 3, kind: 'vo' },
    { name: 'VO Shot 02 — 顾行', sourceUrl: 'https://x/vo2.mp3', startS: 3, durationS: 4, kind: 'vo' },
    { name: 'BGM', sourceUrl: 'https://x/bgm.mp3', startS: 0, durationS: 7, kind: 'bgm' },
  ];

  it('配音进 A 轨、BGM 进 A2,且带素材路径', () => {
    const edl = buildEDL(shots, FPS, 'T', audio);
    expect(edl).toMatch(/\sA\s+C\s/);        // 配音
    expect(edl).toMatch(/\sA2\s+C\s/);        // BGM
    expect(edl).toContain('https://x/vo1.mp3');
    expect(edl).toContain('https://x/bgm.mp3');
    expect(edl).toContain('VO Shot 02 — 顾行'); // 说话人写进片段名,剪辑师能认出是谁
  });

  it('配音起点按成片时间轴排布(第二镜从 3s 起 = 00:00:03:00)', () => {
    const edl = buildEDL(shots, FPS, 'T', audio);
    expect(edl).toContain(secondsToTimecode(3, FPS));
  });

  it('零回归:不传音轨时输出与旧版同形(只有 V 轨)', () => {
    const edl = buildEDL(shots, FPS);
    expect(edl).not.toMatch(/\sA2?\s+C\s/);
  });
});

describe('v12.277 · FCPXML 音频段(此前连 <audio> 都没有)', () => {
  const shots: EdlShot[] = [{ name: 'Shot 01', durationS: 3 }];
  it('有音轨时产出 <audio>,vo 与 bgm 各自独立 track', () => {
    const xml = buildFCPXML(shots, FPS, 'Seq', [
      { name: 'VO 1', sourceUrl: 'https://x/a.mp3', startS: 0, durationS: 3, kind: 'vo' },
      { name: 'BGM', sourceUrl: 'https://x/b.mp3', startS: 0, durationS: 3, kind: 'bgm' },
    ]);
    expect(xml).toContain('<audio>');
    expect(xml).toContain('id="vo-1"');
    expect(xml).toContain('id="bgm-1"');
    expect(xml).toContain('https://x/a.mp3');
    // 两条 track:vo 一条、bgm 一条
    expect((xml.match(/<track>/g) || []).length).toBe(3); // 1 视频 + 2 音频
  });

  it('零回归:无音轨时不产出 <audio> 段', () => {
    const xml = buildFCPXML(shots, FPS, 'Seq');
    expect(xml).not.toContain('<audio>');
    expect((xml.match(/<track>/g) || []).length).toBe(1);
  });

  it('XML 特殊字符被转义(片段名可能含 & < >)', () => {
    const xml = buildFCPXML([{ name: 'A & B <x>', durationS: 2 }], FPS);
    expect(xml).toContain('A &amp; B &lt;x&gt;');
  });
});

describe('v12.277 · 成片终值 vs 设计时长(本版要修的「错」)', () => {
  it('时长不同 → 时间码就不同:证明用错来源会让整条剪辑线漂', () => {
    // 设计 5s,成片经变速后 3.5s
    const design = buildEDL([{ name: 'S1', durationS: 5 }, { name: 'S2', durationS: 5 }], FPS);
    const real = buildEDL([{ name: 'S1', durationS: 3.5 }, { name: 'S2', durationS: 5 }], FPS);
    // 第二镜的 record-in:设计口径 00:00:05:00,终值口径 00:00:03:12
    expect(design).toContain(secondsToTimecode(5, FPS));
    expect(real).toContain(secondsToTimecode(3.5, FPS));
    expect(design).not.toBe(real);
  });

  it('路由以 timeline 终值为准、script 仅兜底(接线锁)', () => {
    const src = require('fs').readFileSync('app/api/projects/[id]/export-edl/route.ts', 'utf-8');
    expect(src).toContain("listAssetsByType(projectId, 'timeline')");
    expect(src).toContain('t?.duration');   // 终值优先
    expect(src).toContain('voiceoverClips'); // 音轨接入
    expect(src).toContain('musicUrl');
  });
});

describe('v12.277 · 亚秒精度(修既有 bug:秒被四舍五入成整秒)', () => {
  it('3.5s 必须导成 00:00:03:12,不是 00:00:04:00', () => {
    const edl = buildEDL([{ name: 'S1', durationS: 3.5 }], FPS);
    expect(edl).toContain('00:00:03:12');
    expect(edl).not.toContain('00:00:04:00');
  });

  it('变速产生的典型小数时长逐个保真(4÷0.7=5.714s → 137 帧)', () => {
    const edl = buildEDL([{ name: 'S1', durationS: 4 / 0.7 }], FPS);
    // 5.714s × 24 = 137.14 → 137 帧 = 00:00:05:17
    expect(edl).toContain('00:00:05:17');
  });

  it('累积不漂:20 个 2.5s 镜头总长应为 50s,而非取整后的 40s/60s', () => {
    const shots = Array.from({ length: 20 }, (_, i) => ({ name: `S${i + 1}`, durationS: 2.5 }));
    const xml = buildFCPXML(shots, FPS);
    const total = Number(xml.match(/<duration>(\d+)<\/duration>/)![1]);
    expect(total).toBe(20 * Math.round(2.5 * FPS)); // 1200 帧 = 50s
  });
});
