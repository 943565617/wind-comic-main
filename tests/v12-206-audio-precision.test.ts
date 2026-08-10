/**
 * v12.206 — 音频精度:EBU R128 双遍纯函数(测量/解析/应用)+ apad 呼吸静音接线锁。
 */
import { describe, it, expect } from 'vitest';
import { buildLoudnormMeasureFilter, parseLoudnormJson, buildLoudnormApplyFilter, shouldTwoPassLoudnorm } from '@/lib/audio-ducking';
import fs from 'fs';

describe('v12.206 · 音频精度', () => {
  it('第一遍测量滤镜带 print_format=json', () => {
    expect(buildLoudnormMeasureFilter()).toContain('print_format=json');
    expect(buildLoudnormMeasureFilter()).toContain('I=-14:TP=-1.5:LRA=11');
  });
  it('解析 ffmpeg stderr JSON → measured 值;残缺→null', () => {
    const good = 'x\n{\n  "input_i" : "-18.5",\n  "input_tp" : "-2.1",\n  "input_lra" : "9.3",\n  "input_thresh" : "-28.7",\n  "output_i" : "-14.0"\n}\n';
    const m = parseLoudnormJson(good);
    expect(m).not.toBeNull();
    expect(m!.input_i).toBe('-18.5');
    expect(parseLoudnormJson('no json here')).toBeNull();
    expect(parseLoudnormJson('{"input_i":"nan","input_tp":"-2","input_lra":"9","input_thresh":"-28"}')).toBeNull(); // 非有限数
  });
  it('第二遍应用滤镜喂测量值 + linear=true', () => {
    const f = buildLoudnormApplyFilter({ input_i: '-18.5', input_tp: '-2.1', input_lra: '9.3', input_thresh: '-28.7' });
    expect(f).toContain('measured_I=-18.5');
    expect(f).toContain('measured_TP=-2.1');
    expect(f).toContain('linear=true');
  });
  it('双遍 opt-in 开关 + composer apad/接入', () => {
    expect(shouldTwoPassLoudnorm({} as any)).toBe(false);
    expect(shouldTwoPassLoudnorm({ AUDIO_LOUDNORM_2PASS: '1' } as any)).toBe(true);
    const s = fs.readFileSync('services/video-composer.ts', 'utf-8');
    expect(s).toContain('apad=pad_dur=0.12');
    expect(s).toContain('applyTwoPassLoudnorm');
    expect(s).toContain("process.env.VOICE_APAD_DISABLE === '1'");
  });
});
