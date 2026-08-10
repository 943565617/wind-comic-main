/**
 * lib/comic-panels-extract — 漫画分格的**像素提取薄层**(v12.247)。
 *
 * 纯算法在 `comic-panels.ts`(密度数组 → 格子)。这里只负责用 sharp 把图片变成密度数组:
 * 灰度化 → 限尺寸加速 → 逐行/逐列算「暗像素比例」(漫画白底黑线,暗 = 内容)。
 * 列密度必须**按行带在子图内重算**(整页列投影会把上下格叠一起),所以返回一个闭包持有原始像素。
 */
import sharp from 'sharp';
import { splitIntoPanels, type Panel, type PanelOptions } from './comic-panels';

/** 像素值 < 此值算「内容」(暗)。白底 255,黑线 0。 */
const DARK_THRESHOLD = 200;
/** 提取时把长边限制到此像素,加速(分格是粗粒度,不需要原分辨率)。 */
const MAX_DIM = 1200;

export interface ComicDensity {
  width: number;
  height: number;
  /** 每行暗像素比例(长度 = height)。 */
  rowDensity: number[];
  /** 某行带 [y0,y1) 内每列的暗像素比例(长度 = width)。 */
  colDensityForBand: (band: [number, number]) => number[];
  /** 提取尺寸相对原图的缩放比(把结果 panel 换算回原图用)。 */
  scale: number;
}

/** 从本地图片文件提取行/列密度(灰度 raw buffer,逐像素统计)。 */
export async function extractComicDensity(absPath: string): Promise<ComicDensity> {
  const base = sharp(absPath).grayscale();
  const meta = await base.metadata();
  const origW = meta.width || 0;
  const scale = origW > MAX_DIM ? MAX_DIM / origW : 1;

  const { data, info } = await base
    .resize({ width: Math.round((origW || MAX_DIM) * scale), fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const ch = info.channels; // grayscale 通常 1

  const rowDensity = new Array(height).fill(0);
  for (let y = 0; y < height; y++) {
    let dark = 0;
    const rowStart = y * width * ch;
    for (let x = 0; x < width; x++) {
      if (data[rowStart + x * ch] < DARK_THRESHOLD) dark++;
    }
    rowDensity[y] = dark / width;
  }

  const colDensityForBand = ([y0, y1]: [number, number]): number[] => {
    const cols = new Array(width).fill(0);
    const rows = Math.max(1, y1 - y0);
    for (let x = 0; x < width; x++) {
      let dark = 0;
      for (let y = y0; y < y1; y++) {
        if (data[(y * width + x) * ch] < DARK_THRESHOLD) dark++;
      }
      cols[x] = dark / rows;
    }
    return cols;
  };

  return { width, height, rowDensity, colDensityForBand, scale };
}

/** 一步到位:从图片文件算出格子边界框(已换算回**原图**坐标)。 */
export async function detectComicPanels(absPath: string, opts: PanelOptions = {}): Promise<Panel[]> {
  const d = await extractComicDensity(absPath);
  const panels = splitIntoPanels(d.rowDensity, d.colDensityForBand, d.width, d.height, opts);
  if (d.scale === 1) return panels;
  const inv = 1 / d.scale;
  return panels.map((p) => ({
    ...p,
    x: Math.round(p.x * inv),
    y: Math.round(p.y * inv),
    w: Math.round(p.w * inv),
    h: Math.round(p.h * inv),
  }));
}
