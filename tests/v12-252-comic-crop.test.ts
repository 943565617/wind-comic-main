/**
 * v12.252 — 漫转视频裁图:合成「上下两格」图端到端裁出 2 张,尺寸合理、区域 clamp。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { detectComicPanels } from '@/lib/comic-panels-extract';
import { cropPanels } from '@/lib/comic-crop';

describe('v12.253 · 出站抓取字节上限(复检 high 修复)', () => {
  // 用假 Response(带 ReadableStream body)验证:超上限 → null(不全量入堆);内 → Buffer。
  const makeResp = (chunks: Uint8Array[], contentLength?: number): Response => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) { for (const ch of chunks) c.enqueue(ch); c.close(); },
    });
    const headers = new Headers();
    if (contentLength != null) headers.set('content-length', String(contentLength));
    return new Response(stream, { headers });
  };

  it('累计字节超上限 → 返回 null(流式中止)', async () => {
    const { readBodyCapped } = await import('@/lib/asset-storage');
    const resp = makeResp([new Uint8Array(60), new Uint8Array(60)]); // 共 120B
    expect(await readBodyCapped(resp, 100)).toBeNull();
  });

  it('上限内 → 返回完整 Buffer', async () => {
    const { readBodyCapped } = await import('@/lib/asset-storage');
    const resp = makeResp([new Uint8Array(30), new Uint8Array(30)]); // 共 60B
    const buf = await readBodyCapped(resp, 100);
    expect(buf).not.toBeNull();
    expect(buf!.length).toBe(60);
  });

  it('Content-Length 声明超上限 → 直接拒(不读流)', async () => {
    const { readBodyCapped } = await import('@/lib/asset-storage');
    const resp = makeResp([new Uint8Array(10)], 999999);
    expect(await readBodyCapped(resp, 100)).toBeNull();
  });
});

describe('v12.252 · 漫转裁图接线锁', () => {
  it('crop 端点存在 + 落地(继承 SSRF/验签)+ 签名 URL', () => {
    const r = fs.readFileSync('app/api/comic/crop/route.ts', 'utf-8');
    expect(r).toContain('persistAsset');           // 图片先落地,继承 SSRF/验签/白名单
    expect(r).toContain('cropPanels');
    expect(r).toContain('serveFilePathUrl');        // 每格返回签名 URL
    expect(r).toContain('MAX_PANELS');              // 封顶防病态图
  });
  it('comic 页调 crop 端点 + 一键交接单图变视频', () => {
    const p = fs.readFileSync('app/dashboard/comic/page.tsx', 'utf-8');
    expect(p).toContain('/api/comic/crop');
    expect(p).toContain('/dashboard/u2v?image=');   // 每格 → u2v 加动效
  });
  it('u2v 页支持 ?image= 预填(仅同站/安全前缀)', () => {
    const p = fs.readFileSync('app/dashboard/u2v/page.tsx', 'utf-8');
    expect(p).toMatch(/URLSearchParams|searchParams/);
    expect(p).toMatch(/serve-file\|data:\|https\?:/); // 白名单前缀校验
  });
});

const W = 300, H = 600;
let imgPath: string;
let outDir: string;

beforeAll(async () => {
  const raw = Buffer.alloc(W * H * 3, 255);
  const paint = (y0: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = 30; x < W - 30; x++) {
      const i = (y * W + x) * 3; raw[i] = 20; raw[i + 1] = 20; raw[i + 2] = 20;
    }
  };
  paint(20, 260); paint(340, 580);
  imgPath = path.join(os.tmpdir(), `comic-crop-src-${process.pid}.png`);
  outDir = path.join(os.tmpdir(), `comic-crop-out-${process.pid}`);
  await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toFile(imgPath);
});
afterAll(() => {
  try { fs.unlinkSync(imgPath); } catch { /* noop */ }
  try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* noop */ }
});

describe('v12.252 cropPanels', () => {
  it('上下两格 → 裁出 2 张真图,每张尺寸 > 0 且落在原图内', async () => {
    const panels = await detectComicPanels(imgPath);
    expect(panels.length).toBe(2);
    const cropped = await cropPanels(imgPath, panels, outDir, 'testimg');
    expect(cropped.length).toBe(2);
    for (const c of cropped) {
      expect(fs.existsSync(c.absPath)).toBe(true);
      const m = await sharp(c.absPath).metadata();
      expect((m.width || 0)).toBeGreaterThan(0);
      expect((m.height || 0)).toBeGreaterThan(0);
      expect((m.width || 0)).toBeLessThanOrEqual(W);
      expect((m.height || 0)).toBeLessThanOrEqual(H);
    }
  });

  it('越界框被 clamp,不抛错(区域超出原图右下角)', async () => {
    // 人为造一个超出边界的框:x/y 接近右下、w/h 远超剩余空间
    const panels = [{ x: W - 10, y: H - 10, w: 500, h: 500, row: 0, col: 0 }];
    const cropped = await cropPanels(imgPath, panels, outDir, 'oob');
    expect(cropped.length).toBe(1);
    expect(fs.existsSync(cropped[0].absPath)).toBe(true);
    const m = await sharp(cropped[0].absPath).metadata();
    expect((m.width || 0)).toBeGreaterThanOrEqual(1);
    expect((m.width || 0)).toBeLessThanOrEqual(10);
  });
});
