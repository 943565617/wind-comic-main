/**
 * v12.152 — 剧本册离线导出:md/html 纯函数 + 路由/UI 接线锁。
 */
import { describe, it, expect } from 'vitest';
import { pullSheetToMarkdown, buildScriptBookHtml, shotCinemaLine } from '@/lib/script-export';
import { buildPullSheetFromScript } from '@/lib/pull-sheet';
import fs from 'fs';

const script = {
  title: '便利店的第七夜', logline: '深夜便利店的监控谜团', synopsis: '凌晨3:03…',
  shots: [
    { shotNumber: 1, duration: 6, sceneDescription: '定场:深夜便利店', characters: ['小周'], dialogue: '又是三点…', shotSize: 'wide', cameraMovement: 'dolly-in', lens: '24mm', storyBeat: 'hook' },
    { shotNumber: 2, duration: 5, sceneDescription: '监控屏特写', characters: ['小周'], dialogue: '', shotSize: 'CU', cameraMovement: 'static' },
  ],
};

describe('v12.152 · 剧本册导出', () => {
  const sheet = buildPullSheetFromScript(script as any);
  it('markdown:标题/logline/逐镜卡/附录表齐全,竖线转义', () => {
    const md = pullSheetToMarkdown(sheet, { title: script.title, logline: script.logline, synopsis: script.synopsis });
    expect(md).toContain('# 便利店的第七夜');
    expect(md).toContain('**Logline**');
    expect(md).toContain('## S1(00:00–00:06,6s)');
    expect(md).toContain('台词:「又是三点…」');
    expect(md).toContain('| S2 | 00:06 | CU | static |');
  });
  it('html:结构完整、HTML 转义、缩略图 onerror 自隐藏', () => {
    const withThumb = buildPullSheetFromScript(script as any, { storyboards: [{ shotNumber: 1, url: '/api/serve-file?path=x.png' }] });
    const html = buildScriptBookHtml(withThumb, { title: '<b>注入</b>' });
    expect(html).toContain('&lt;b&gt;注入&lt;/b&gt;');
    expect(html).toContain("onerror=\"this.style.display='none'\"");
    expect(html).toContain('S1');
    expect(html).toContain('附录 · 分镜表');
  });
  it('shotCinemaLine:有什么拼什么', () => {
    expect(shotCinemaLine(sheet.shots[0])).toBe('wide · dolly-in · 24mm');
    expect(shotCinemaLine({ ...sheet.shots[1], shotSize: '', cameraMovement: '' } as any)).toBe('');
  });
  it('接线锁:路由 md/pdf 分支(origin 补全+puppeteer 系统 Chrome 优先)+ UI 双按钮', () => {
    const route = fs.readFileSync('app/api/projects/[id]/pull-sheet/route.ts', 'utf-8');
    expect(route).toContain("format === 'md' || format === 'pdf'");
    expect(route).toContain("channel: 'chrome'");
    expect(route).toContain('`${origin}${sh.thumbnail}`');
    const ui = fs.readFileSync('components/project/pull-sheet-table.tsx', 'utf-8');
    expect(ui).toContain('format=md');
    expect(ui).toContain('format=pdf');
  });
});
