/**
 * lib/comic-crop — 漫画分格「裁图」层(v12.252)。
 *
 * 分格(comic-panels / -extract)只给边界框;本层把每格从原图真正裁出来存成图片文件,
 * 让「漫转视频」有可喂给单图变视频(u2v)的素材 —— 漫 → 分格 → 每格裁图 → 加动效 → 拼接。
 *
 * 纯本地 sharp,无付费外呼。裁切区域会 clamp 到图内(sharp extract 越界会抛),坐标是原图尺度。
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import type { Panel } from './comic-panels';

export interface CroppedPanel extends Panel {
  /** 裁出的格子图片本地绝对路径。 */
  absPath: string;
}

/**
 * 把每格从原图裁出,写到 outDir,文件名 `${stem}-panel-N.png`。
 * @param srcAbsPath 原图本地路径  @param panels 原图尺度的格子  @param outDir 输出目录(需在 serve-file 白名单根内)  @param stem 文件名前缀(建议用内容 hash,稳定去重)
 */
export async function cropPanels(srcAbsPath: string, panels: Panel[], outDir: string, stem: string): Promise<CroppedPanel[]> {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const meta = await sharp(srcAbsPath).metadata();
  const W = meta.width || 0;
  const H = meta.height || 0;
  const out: CroppedPanel[] = [];
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    // clamp:left/top 落在 [0, 尺寸-1],width/height 至少 1、且不超过剩余空间 —— 防 sharp extract 越界抛错。
    const left = Math.max(0, Math.min(Math.round(p.x), Math.max(0, W - 1)));
    const top = Math.max(0, Math.min(Math.round(p.y), Math.max(0, H - 1)));
    const width = Math.max(1, Math.min(Math.round(p.w), W - left));
    const height = Math.max(1, Math.min(Math.round(p.h), H - top));
    const dst = path.join(outDir, `${stem}-panel-${i + 1}.png`);
    await sharp(srcAbsPath).extract({ left, top, width, height }).png().toFile(dst);
    out.push({ ...p, absPath: dst });
  }
  return out;
}
