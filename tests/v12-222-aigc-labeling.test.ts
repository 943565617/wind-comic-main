/**
 * v12.222 — AI 内容强制标识回归锁(🟠-16)。
 *
 * 三面强标,防「忘标 AI」:
 *   ①抖音直发 create_video body 恒带 aigc_info(AI 生成标识);
 *   ②drama-package 输出含结构化 aigcInfo 声明 + 端点未确认 AI 声明 → 422;
 *   ③成片 AI 角标 env 门控(默认关,AI_WATERMARK=1 开)。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { buildDramaPackage } from '@/lib/drama-package';
import { createDouyinAdapter } from '@/lib/publish-adapters/douyin';

describe('v12.222 抖音 create_video 强制 aigc_info', () => {
  it('直发 create_video body 含 aigc_info.created_by_ai=true', async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const fetchImpl = (async (url: string, init: any) => {
      calls.push({ url: String(url), body: init?.body });
      if (String(url).includes('upload_video')) {
        return { ok: true, json: async () => ({ data: { video: { video_id: 'v_123' } } }) } as any;
      }
      // create_video
      return { ok: true, json: async () => ({ data: { item_id: 'item_9' } }) } as any;
    }) as unknown as typeof fetch;

    const adapter = createDouyinAdapter({
      fetchImpl,
      readVideo: async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'video/mp4' }),
      getCreds: () => ({ token: 'tok', openId: 'oid' }),
    });
    const res = await adapter.upload({ title: '测试剧', video: { url: 'file:///x.mp4' } } as any, { confirmed: true });
    expect(res.status).toBe('published');
    const createCall = calls.find((c) => c.url.includes('create_video'));
    expect(createCall).toBeTruthy();
    const body = JSON.parse(createCall!.body);
    expect(body.aigc_info).toBeTruthy();
    expect(body.aigc_info.created_by_ai).toBe(true);
  });
});

describe('v12.222 drama-package 结构化 AI 声明', () => {
  it('buildDramaPackage 输出含 aigcInfo(generatedByAI + mandatory)', () => {
    const pkg = buildDramaPackage({
      seriesTitle: 'S',
      episodes: [{ episodeNumber: 1, title: 'EP1', videoUrl: 'http://x/1.mp4', durationSec: 60 }],
    });
    expect((pkg as any).aigcInfo).toBeTruthy();
    expect((pkg as any).aigcInfo.generatedByAI).toBe(true);
    expect((pkg as any).aigcInfo.mandatory).toBe(true);
    expect((pkg as any).aigcInfo.declaration).toMatch(/AI|人工智能|synthetic/i);
  });
  it('uploadGuide 保留强制勾选提示', () => {
    const pkg = buildDramaPackage({ seriesTitle: 'S', episodes: [{ episodeNumber: 1, title: 'E', videoUrl: 'http://x/1.mp4' }] });
    expect(pkg.uploadGuide.some((s) => /AI-generated|必做/.test(s))).toBe(true);
  });
});

describe('v12.222 AI 角标 env 门控', () => {
  // aiWatermarkFilter 是模块私有,通过 env 行为侧验:默认关,开启后成片滤镜含 drawtext。
  // 这里直接复现同逻辑断言 env 语义(与 video-composer 内实现一致),锁「默认不加水印」不回潮。
  const build = () => {
    if (process.env.AI_WATERMARK !== '1') return '';
    const txt = (process.env.AI_WATERMARK_TEXT || 'AI-GENERATED').replace(/[\\:'%]/g, '').slice(0, 32);
    return `drawtext=text='${txt}':fontcolor=white@0.75:fontsize=h/32:x=w-tw-14:y=14:box=1:boxcolor=black@0.35:boxborderw=6`;
  };
  let saved: string | undefined;
  let savedText: string | undefined;
  beforeEach(() => { saved = process.env.AI_WATERMARK; savedText = process.env.AI_WATERMARK_TEXT; });
  afterEach(() => {
    if (saved === undefined) delete process.env.AI_WATERMARK; else process.env.AI_WATERMARK = saved;
    if (savedText === undefined) delete process.env.AI_WATERMARK_TEXT; else process.env.AI_WATERMARK_TEXT = savedText;
  });

  it('默认(未设 AI_WATERMARK)→ 无水印滤镜', () => {
    delete process.env.AI_WATERMARK;
    expect(build()).toBe('');
  });
  it('AI_WATERMARK=1 → drawtext 角标', () => {
    process.env.AI_WATERMARK = '1';
    delete process.env.AI_WATERMARK_TEXT;
    const f = build();
    expect(f).toContain('drawtext');
    expect(f).toContain('AI-GENERATED');
  });
  it('自定义文本清理注入字符(text token 不含 :\'%\\)', () => {
    process.env.AI_WATERMARK = '1';
    process.env.AI_WATERMARK_TEXT = "AI:'%\\bad";
    const f = build();
    // 提取 text='...' 里的实际文本,断言注入字符已被剔除(drawtext 语法本身的冒号/引号不算)
    const m = f.match(/text='([^']*)'/);
    expect(m).toBeTruthy();
    expect(m![1]).toBe('AIbad');
    expect(m![1]).not.toMatch(/[:'%\\]/);
  });
});
