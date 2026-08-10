/**
 * v12.269 — 音画同步「同根因旁支」收官:karaoke 字幕 + 原生音轨镜。
 *
 * v12.264/265 修好了默认路径(clean SRT + TTS 配音 + 打击音效 + 画面),但当时明确留了两条
 * 非默认路径的同根漂移。本版一并收口,至此 composeVideo 全部时间轴消费方同源于 computeXfadeTimeline。
 *
 *  ① karaoke ASS(captionStyle='karaoke'):**双重漂移** —— 用 c.duration(ORIGINAL,未含情绪调速/
 *     卡点/变速)且 cursor 纯累加(未减 xfade 重叠)。改为在时间轴定稿后按 clipStartSec 重写。
 *  ② 原生音轨镜(nativeAudioShots):音轨走 concat 首尾硬拼,落在 durations 纯累加位,
 *     比压缩后画面晚 Σ effectiveTd。改为 adelay 定位 + normalize=0 末端叠加(不动既有电平)。
 */
import { describe, it, expect } from 'vitest';
import { computeXfadeTimeline } from '@/services/video-composer';
import fs from 'fs';

const SRC = fs.readFileSync('services/video-composer.ts', 'utf-8');

describe('v12.269 · ① karaoke ASS 时间轴同源', () => {
  it('存下重写句柄,并在时间轴算完后按 clipStartSec 重建', () => {
    expect(SRC).toContain('assResync = { path: assPath, opts: assOpts }');
    expect(SRC).toContain("require('@/lib/ass-karaoke')");
    expect(SRC).toContain('startSec: clipStartSec[k]');
    // 扫光仍对齐 TTS 真实时长(不能被这次改动弄丢)
    expect(SRC).toContain('sweepSec: voDur && voDur > 0 ? voDur : undefined');
  });

  it('沿用 SRT 的 gap 退化保护(极短镜不产生 0/负时长)', () => {
    const karaokeBlock = SRC.slice(SRC.indexOf('if (assResync)'));
    expect(karaokeBlock).toContain('durSec: gap > 0 ? gap : durations[k]');
  });

  it('量化:双重漂移下 karaoke 比画面晚多少(变速 + xfade 叠加)', () => {
    // 原始时长 [4,4,4];第 2 镜 0.5x 慢放 → 终值 [4,8,4];转场各 0.5s
    const finalDurations = [4, 8, 4];
    const effectiveTds = [0, 0.5, 0.5];
    const { clipStartSec } = computeXfadeTimeline(finalDurations, effectiveTds);
    expect(clipStartSec).toEqual([0, 3.5, 11]);
    // 旧 karaoke:按 ORIGINAL 时长纯累加 → 第 3 镜起点 8;真实画面起点 11 → 字幕**早了 3s**
    const oldKaraokeStart = [0, 4, 8];
    expect(oldKaraokeStart[2] - clipStartSec[2]).toBeCloseTo(-3, 6);
  });
});

describe('v12.269 · ② 原生音轨镜按压缩后画面起点对齐', () => {
  it('concat 只作静音床;原生音轨改走 adelay(clipStartMs)', () => {
    expect(SRC).toContain('const nd = clipStartMs[i] || 0');
    expect(SRC).toContain('adelay=${nd}|${nd}[${lbl}]');
    // 原来「有原生音轨就塞进 concat」的分支必须消失
    expect(SRC).not.toContain('asetpts=PTS-STARTPTS[a${i}]');
  });

  it('末端 normalize=0 叠加 —— 既有电平分毫不动', () => {
    expect(SRC).toContain('amix=inputs=2:duration=first:normalize=0:dropout_transition=0[outa]');
    // 多镜原生音轨合并同样 normalize=0(时间上互不重叠,不该被均摊压低)
    expect(SRC).toContain('normalize=0:duration=longest:dropout_transition=0[namix]');
  });

  it('零回归:无原生音轨(默认)时滤镜串与旧版逐字节一致', () => {
    // 默认 nativeLabel 为空 → mixOut 直接是 [outa],不产生中间标签
    expect(SRC).toContain("const mixOut = nativeLabel ? '[amixed]' : '[outa]'");
    expect(SRC).toContain('dropout_transition=2${mixOut}');
    expect(SRC).toContain('[aconcat]anull${mixOut}');
  });

  it('量化:3 镜有原生音轨时旧版滞后量', () => {
    const { clipStartSec } = computeXfadeTimeline([4, 4, 4], [0, 0.5, 0.5]);
    const oldConcatPos = [0, 4, 8]; // concat 首尾硬拼位
    expect(oldConcatPos[1] - clipStartSec[1]).toBeCloseTo(0.5, 6);
    expect(oldConcatPos[2] - clipStartSec[2]).toBeCloseTo(1.0, 6);
  });
});

describe('v12.269 · 全部时间轴消费方同源(收官)', () => {
  it('画面/配音/SRT/karaoke/打击音效/原生音轨 六者都取 clipStartSec 或 clipStartMs', () => {
    expect(SRC).toContain('offset=${clipStartSec[i].toFixed(2)}');      // 画面
    expect(SRC).toContain('shotStartMs.set(sn, clipStartMs[k] || 0)');   // 配音
    expect(SRC).toContain('startSec: clipStartSec[k]');                  // SRT + karaoke
    expect(SRC).toContain('startMs2.set(sn, clipStartMs[k] || 0)');      // 打击音效
    expect(SRC).toContain('const nd = clipStartMs[i] || 0');             // 原生音轨
    // 全文不应再有任何「durations 纯累加定位音轨/字幕」的残留
    expect(SRC).not.toContain('cumMs += (durations[k] || 0) * 1000');
    expect(SRC).not.toContain('cum2 += (durations[k] || 0) * 1000');
  });
});
