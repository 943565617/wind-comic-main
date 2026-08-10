/**
 * lib/mv-compose-plan — MV 出片:卡点镜头 + 一组图片 → 每镜静帧动画规格(v12.253)。
 *
 * MV 规划(mv-plan)只给卡点时间轴;出片还需给每镜配一张画面。本层做**纯映射**:
 * 把 N 张图按序循环分配到各卡点镜头,带上该镜的卡点时长 + 轮换的 ken-burns 方向(更有动感)。
 * 真正的 ffmpeg 静帧转视频 + 卡点拼接 + 配乐在端点层(stillFrameToVideo + composeVideo),这里只算「怎么分」。
 */
import type { MvShot } from './mv-plan';

export interface MvClipSpec {
  shotNumber: number;
  imageUrl: string;
  durationSec: number;
  zoomDir: 'in' | 'out' | 'pan';
}

const ZOOMS: Array<'in' | 'out' | 'pan'> = ['in', 'out', 'pan'];

export interface MvVideoClipSpec {
  shotNumber: number;
  videoUrl: string;
  /** 该镜的卡点时长;合成时源片会被裁到这个长度,实现「真片段按拍硬切」。 */
  durationSec: number;
}

/**
 * 卡点镜头 × 真视频片段 → 每镜一段真片段规格(v12.254)。
 * 与 assignMvClips 同构:片段不足时按序循环复用。合成层 composeVideo 会把每段源片**裁到 durationSec**
 * (见 video-composer 的「设计时长裁切」),从而把用户自带/单图变视频出的真片段按卡点硬切成 MV。
 * shots 或 videoUrls 为空 → 空数组(端点据此回 400,不进 ffmpeg)。
 */
export function assignMvVideoClips(shots: MvShot[], videoUrls: string[]): MvVideoClipSpec[] {
  if (!shots?.length || !videoUrls?.length) return [];
  return shots.map((s, i) => ({
    shotNumber: s.index,
    videoUrl: videoUrls[i % videoUrls.length],
    durationSec: s.durationSec,
  }));
}

/**
 * 卡点镜头 × 图片 → 每镜一段静帧动画的规格。图片不足时循环复用;ken-burns 方向逐镜轮换。
 * shots 或 imageUrls 为空 → 空数组(端点据此回 400,不进 ffmpeg)。
 */
export function assignMvClips(shots: MvShot[], imageUrls: string[]): MvClipSpec[] {
  if (!shots?.length || !imageUrls?.length) return [];
  return shots.map((s, i) => ({
    shotNumber: s.index,
    imageUrl: imageUrls[i % imageUrls.length],
    durationSec: s.durationSec,
    zoomDir: ZOOMS[i % ZOOMS.length],
  }));
}
