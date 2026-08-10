/**
 * v12.258 — 片头/片尾接进 export 出口(开关)。
 * intro-outro.ts 后端早已完整,此前出口零调用;本版接进 /api/projects/[id]/export?intro=1 + UI 开关。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { buildWrapConcatFilters, escapeDrawtextText } from '@/services/intro-outro';

describe('v12.258 buildWrapConcatFilters(纯函数)', () => {
  it('三段都 scale+pad 到正片 WxH,concat n=3', () => {
    const f = buildWrapConcatFilters({ width: 1080, height: 1920, hasAudio: true, duration: 30 });
    // 三个视频规格化 + 一条 concat
    expect(f.filter((s) => s.includes('scale=1080:1920')).length).toBe(3);
    expect(f.some((s) => s.includes('pad=1080:1920'))).toBe(true);
    expect(f.some((s) => s.includes('concat=n=3:v=1:a=1[vout][aout]'))).toBe(true);
  });
  it('正片有音轨 → 用 [1:a],不补静音', () => {
    const f = buildWrapConcatFilters({ width: 1920, height: 1080, hasAudio: true, duration: 10 });
    expect(f.some((s) => s.includes('anullsrc'))).toBe(false);
    expect(f.some((s) => s.includes('[v0][0:a][v1][1:a][v2][2:a]concat'))).toBe(true);
  });
  it('正片无音轨 → 给中段补静音(避免 concat a=1 缺流报错)', () => {
    const f = buildWrapConcatFilters({ width: 1280, height: 720, hasAudio: false, duration: 12 });
    expect(f.some((s) => s.includes('anullsrc') && s.includes('[a1gen]'))).toBe(true);
    expect(f.some((s) => s.includes('[v1][a1gen][v2]'))).toBe(true);
  });
});

describe('v12.258 · 片头片尾出口接线锁', () => {
  it('export 路由支持 ?intro=1,调 wrapWithIntroOutro,失败明确 500', () => {
    const r = fs.readFileSync('app/api/projects/[id]/export/route.ts', 'utf-8');
    expect(r).toMatch(/intro'\) === '1'/);
    expect(r).toContain('wrapWithIntroOutro');
    expect(r).toContain('片头片尾合成失败');            // 失败 500,不静默返回无片头版本
    expect(r).toMatch(/wantTranscode \|\| wantIntro/);   // 远端 URL 拒绝 intro(需本地)
  });
  it('导出 dropdown 有「含片头片尾」开关 → &intro=1', () => {
    const p = fs.readFileSync('components/project/export-resolution-dropdown.tsx', 'utf-8');
    expect(p).toContain('含片头片尾');
    expect(p).toMatch(/withIntro \? '&intro=1' : ''/);
  });
});

describe('v12.258 · 复检修复锁', () => {
  it('#1/#4 每请求唯一片头目录(并发不撞固定名)+ 流后清理', () => {
    const r = fs.readFileSync('app/api/projects/[id]/export/route.ts', 'utf-8');
    expect(r).toMatch(/intro-\$\{crypto\.randomUUID\(\)\}/);   // 唯一目录
    expect(r).toMatch(/stream\.on\('close'/);                 // 发完清理
  });
  it('#2 escapeDrawtextText 中和 %{...} 展开(花括号转全角)', () => {
    const out = escapeDrawtextText('片名%{pts}测试');
    expect(out).not.toContain('{');
    expect(out).not.toContain('}');
    expect(out).toContain('｛'); // 全角,drawtext 不会当展开标记
  });
  it('#3 封面 ?key= 也能解析(resolveByKey 兜底)', () => {
    const r = fs.readFileSync('app/api/projects/[id]/export/route.ts', 'utf-8');
    expect(r).toContain('resolveByKey');
    expect(r).toMatch(/key=\(\[\^&\]\+\)/);
  });
});
