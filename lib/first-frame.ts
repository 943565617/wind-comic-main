/**
 * 引擎首帧图通道(v12.154.0,批量补渲实测三修之一)。
 *
 * 病根:补渲/重生路径把站内 serve-file URL 或**已过期的 CDN 签名 URL**直接喂给
 * MiniMax/Kling,引擎取不到 → "invalid image url"。本模块统一解决:
 *   - 站内 serve-file(?path= / ?key=)→ 读本地文件转 data:image base64(引擎官方均支持 base64)
 *   - http(s) → 原样(引擎自取;取不到由引擎报错进下一档)
 *   - 其他/读失败 → null(调用方走无首帧分支,诚实降级)
 */
import fs from 'fs';
import path from 'path';

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
};

/** serve-file URL → 本地绝对路径(?path= 直解 / ?key= 注册表反查);非站内 → null。 */
export function serveFileToLocalPath(url: string): string | null {
  try {
    if (!url.startsWith('/api/serve-file')) return null;
    const q = new URLSearchParams(url.split('?')[1] || '');
    const p = q.get('path');
    if (p) {
      // v12.237(第四轮对抗复检 · CRITICAL):?path= 此前直接 decode 返回本地路径,不验签 ——
      // toEngineImage 会把它读成 base64 喂引擎 / video-anchor 会 ffmpeg 抽帧,等于绕过 v12.236 签名读任意文件。
      // 现在强制验 HMAC 签名 + 白名单;?key= 是内容寻址(SHA-256 不可枚举/伪造),保持原样。
      const { resolveVerifiedServeFilePath } = require('./serve-file-sign') as typeof import('./serve-file-sign');
      return resolveVerifiedServeFilePath(url);
    }
    const key = q.get('key');
    if (key) {
      const { resolveByKey } = require('./asset-storage') as typeof import('./asset-storage');
      return resolveByKey(key)?.absPath || null;
    }
  } catch { /* fallthrough */ }
  return null;
}

/** 首帧图 → 引擎可取形态:http 原样 / 站内转 base64 data URI / 失败 null。 */
export function toEngineImage(url: string | null | undefined): string | null {
  const u = (url || '').trim();
  if (!u) return null;
  if (u.startsWith('data:image/')) return u;
  if (u.startsWith('http://') || u.startsWith('https://')) return u;
  const local = serveFileToLocalPath(u);
  if (!local || !fs.existsSync(local)) return null;
  try {
    const stat = fs.statSync(local);
    if (stat.size > 18 * 1024 * 1024) return null; // 引擎 base64 上限普遍 ~20MB,留余量
    const mime = MIME[path.extname(local).toLowerCase()];
    if (!mime) return null; // mp4 等非图不转
    return `data:${mime};base64,${fs.readFileSync(local).toString('base64')}`;
  } catch { return null; }
}

/**
 * 资产行 → 引擎首帧候选 URL:原始 media_urls 里的 http(多为 CDN)优先,
 * 退 persistent_url / 首个 media_urls(站内形态交给 toEngineImage 转 base64)。
 */
export function pickEngineImageUrl(asset: { persistent_url?: string | null; media_urls?: string | null }): string {
  let urls: string[] = [];
  try { urls = JSON.parse(asset.media_urls || '[]'); } catch { /* ignore */ }
  const httpFirst = urls.find((u) => typeof u === 'string' && /^https?:\/\//.test(u));
  return httpFirst || asset.persistent_url || urls[0] || '';
}
