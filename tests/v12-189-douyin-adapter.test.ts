/**
 * v12.189 — 抖音直发适配器:注入依赖单测(未配降级/未确认降级/两步直发/异常降级)。
 */
import { describe, it, expect } from 'vitest';
import { createDouyinAdapter } from '@/lib/publish-adapters/douyin';

const PKG: any = { video: { url: 'https://cdn/x.mp4' }, title: '标题', spec: {}, titleAlternatives: [] };

describe('v12.189 · 抖音适配器', () => {
  it('未配凭据 → manual 降级带指引;绝不 published', async () => {
    const a = createDouyinAdapter({ getCreds: () => ({}) });
    expect(a.isConfigured()).toBe(false);
    const r = await a.upload(PKG, { confirmed: true });
    expect(r.status).toBe('manual');
    expect(r.instructions?.join('')).toContain('developer.open-douyin.com');
  });
  it('已配但未 confirmed → manual(外发确认闸)', async () => {
    const a = createDouyinAdapter({ getCreds: () => ({ token: 't', openId: 'o' }) });
    const r = await a.upload(PKG);
    expect(r.status).toBe('manual');
    expect(r.message).toContain('确认');
  });
  it('两步直发:upload→create,item_id 即 published;任一步失败降级', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: any, init?: any) => {
      calls.push(String(url));
      if (String(url).includes('upload_video')) return new Response(JSON.stringify({ data: { video: { video_id: 'vid1' } } }));
      return new Response(JSON.stringify({ data: { item_id: 'item9' } }));
    }) as any;
    const a = createDouyinAdapter({
      fetchImpl,
      getCreds: () => ({ token: 't', openId: 'o' }),
      readVideo: async () => ({ bytes: new Uint8Array([1]), contentType: 'video/mp4' }),
    });
    const r = await a.upload(PKG, { confirmed: true });
    expect(r.status).toBe('published');
    expect(r.externalId).toBe('item9');
    expect(calls.length).toBe(2);
    // 失败路径
    const bad = createDouyinAdapter({
      fetchImpl: (async () => new Response(JSON.stringify({ message: 'err' }))) as any,
      getCreds: () => ({ token: 't', openId: 'o' }),
      readVideo: async () => ({ bytes: new Uint8Array([1]), contentType: 'video/mp4' }),
    });
    expect((await bad.upload(PKG, { confirmed: true })).status).toBe('manual');
  });
});
