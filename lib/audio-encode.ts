/**
 * 成片音频编码参数(v12.195.0,纯函数)。
 *
 * 病根:全链 `-b:a 128k` 硬编码 —— 抖音/小红书等平台上传后会按自家标准二次转码,
 * 源 128k AAC 再压一遍,BGM 高频和人声齿音明显劣化。行业做法:社媒竖屏投稿源留
 * 192k 余量(平台压完仍在可听阈上),其余场景 160k。
 */

const SOCIAL_PLATFORMS = new Set([
  'douyin', 'tiktok', 'xiaohongshu', 'kuaishou', 'shipinhao', 'reels', 'shorts', 'youtube_shorts',
]);

/** 平台 → 音频码率。未知/未指定平台走 160k(仍优于旧 128k)。 */
export function audioBitrateForPlatform(platform?: string | null): string {
  const p = (platform || '').trim().toLowerCase();
  return SOCIAL_PLATFORMS.has(p) ? '192k' : '160k';
}
