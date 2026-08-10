/**
 * v12.205 — 视觉质量基底:CRF 参数化 + unsharp 锐化 + vignette 晕影 + 多镜开头淡入。
 */
import { describe, it, expect } from 'vitest';
import { buildColorGradeFilter } from '@/lib/color-grade';
import fs from 'fs';

describe('v12.205 · 视觉质量基底', () => {
  it('vignette 默认挂 + env 关', () => {
    expect(buildColorGradeFilter('default')).toContain('vignette=PI/5:eval=init');
    expect(buildColorGradeFilter('default', { VIGNETTE_DISABLE: '1' } as any)).not.toContain('vignette');
    expect(buildColorGradeFilter('default', { VIGNETTE_DISABLE: '1' } as any)).toContain('eq=contrast');
  });
  it('composer:CRF 参数化(无残留硬编码23)+ unsharp + 开头淡入', () => {
    const s = fs.readFileSync('services/video-composer.ts', 'utf-8');
    expect(s).not.toMatch(/'-crf', '23'/); // 全部走 crfValue()
    expect(s).toContain('crfValue()');
    expect(s).toContain('process.env.CRF_QUALITY');
    expect(s).toContain('unsharp=luma_msize_x=3');
    expect(s).toContain("process.env.UNSHARP_DISABLE === '1'");
    expect(s).toContain('fade=t=in:st=0:d=0.5'); // 多镜开头淡入
  });
  it('CRF 默认 20,env 可覆盖', () => {
    const prev = process.env.CRF_QUALITY;
    delete process.env.CRF_QUALITY;
    // crfValue 是模块内函数,通过读源码验证默认值语义
    const s = fs.readFileSync('services/video-composer.ts', 'utf-8');
    expect(s).toContain("process.env.CRF_QUALITY || '20'");
    if (prev !== undefined) process.env.CRF_QUALITY = prev;
  });
});
