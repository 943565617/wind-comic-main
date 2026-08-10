/**
 * v12.247 — 漫画分格 sharp 提取薄层:用合成图端到端验证。
 * 不依赖外部素材:sharp 现造一张「上下两格、中间白 gutter」的图,分格应得 2 格。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { extractComicDensity, detectComicPanels } from '@/lib/comic-panels-extract';

const W = 300, H = 600;
let imgPath: string;

beforeAll(async () => {
  // 白底;上格 y=20~260 填黑块,下格 y=340~580 填黑块,中间 260~340 留白 gutter
  const raw = Buffer.alloc(W * H * 3, 255); // 全白 RGB
  const paint = (y0: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = 30; x < W - 30; x++) {
      const i = (y * W + x) * 3; raw[i] = 20; raw[i + 1] = 20; raw[i + 2] = 20;
    }
  };
  paint(20, 260); paint(340, 580);
  imgPath = path.join(os.tmpdir(), `comic-test-${process.pid}.png`);
  await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toFile(imgPath);
});
afterAll(() => { try { fs.unlinkSync(imgPath); } catch { /* noop */ } });

describe('v12.247 extractComicDensity', () => {
  it('gutter 行密度低、内容行密度高', async () => {
    const d = await extractComicDensity(imgPath);
    expect(d.height).toBeGreaterThan(0);
    // 上格中部(约 20% 高度处)应有内容
    const midTop = d.rowDensity[Math.round(d.height * 0.2)];
    // gutter(约 50% 高度处)应接近 0
    const midGutter = d.rowDensity[Math.round(d.height * 0.5)];
    expect(midTop).toBeGreaterThan(0.3);
    expect(midGutter).toBeLessThan(0.05);
  });
});

describe('v12.247 detectComicPanels 端到端', () => {
  it('上下两格 → 切出 2 格,坐标换算回原图尺度', async () => {
    const panels = await detectComicPanels(imgPath);
    expect(panels.length).toBe(2);
    // 两格都在合理位置(第一格在上半,第二格在下半)
    expect(panels[0].y).toBeLessThan(H * 0.5);
    expect(panels[1].y).toBeGreaterThan(H * 0.4);
    // 坐标在原图尺度内
    for (const p of panels) {
      expect(p.x + p.w).toBeLessThanOrEqual(W + 2);
      expect(p.y + p.h).toBeLessThanOrEqual(H + 2);
    }
  });
});
