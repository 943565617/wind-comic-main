/**
 * v12.236(第三轮对抗复检 · serve-file `?path=` 跨用户 IDOR)。
 *
 * 问题:`?path=` 模式此前只做「登录 + 目录白名单」——任何**已登录**用户只要知道另一个用户
 * 成片的绝对路径(成片名是 `final-${Date.now()}.mp4`,时间戳可从 SSE 事件 / 网络日志推算),
 * 带自己的 cookie 就能下载他人的成片 / 封面 / TTS 音频。路径本身不含 projectId,无从反查归属。
 *
 * 解法:把 `?path=` 变成**签名能力 URL**(类比 S3 presigned URL)——
 * 服务端签发时用 `signServeFilePath()` 附一段 HMAC,serve-file 读取时验签,伪造不了签名就进不来。
 * 这样「任意登录用户构造任意路径」被降级为「只能访问服务端真的签发过的 URL」,
 * 与 `?key=`(内容寻址、不可枚举的能力 URL)同一安全模型。
 *
 * 兼容性:所有**解析** `?path=` 的消费方(video-composer / last-frame-extractor / cameo-vision 等)
 * 都用 `new URL().searchParams.get('path')` 取值,天然忽略多出来的 `&sig=`,不受影响。
 * 无签名的历史 URL 会被拒(403)——本地媒体路径 URL 本就易随文件清理失效,持久成片走 `?key=`。
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * serve-file `?path=` 允许的根目录白名单 —— 与 serve-file 路由一致,抽出来给所有
 * 「解析 ?path= 直接读本地文件」的消费方共用(v12.237)。
 */
export function serveFileAllowedRoots(): string[] {
  const cwd = process.cwd();
  return [
    os.tmpdir(),
    path.join(cwd, 'data', 'composed'),
    path.join(cwd, 'data', 'exports'),
    path.join(cwd, 'data', 'storage'),
    path.join(cwd, 'data', 'media'),
    path.join(cwd, 'data', 'covers'),
  ].map((p) => path.resolve(p));
}

/** 绝对路径是否落在白名单根目录内。 */
export function isServeFilePathAllowed(absPath: string): boolean {
  const resolved = path.resolve(absPath);
  return serveFileAllowedRoots().some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

/**
 * v12.237(第四轮对抗复检 · CRITICAL):从一个 `/api/serve-file?path=X&sig=Y` URL 解析出
 * **经 HMAC 验签 + 白名单校验**的本地绝对路径;任一不过关返回 null。
 *
 * 由来:v12.236 只给 serve-file 的 **HTTP 端点**加了签名,却漏了两条**服务端本地解析路径** ——
 * `lib/asset-storage.ts` 的 persistAsset 和 `lib/first-frame.ts` 的 serveFileToLocalPath,
 * 它们遇到 `?path=` 时用 URLSearchParams 取值**直接 readFileSync**,不经 HTTP 层、不验签、无白名单。
 * cameo / pull-sheet / video-anchor 三个入口把用户 body 的 imageUrl/videoUrl 原样喂进来,
 * 于是「任意登录用户提交 `?path=/data/composed/别人的成片.mp4`」就能把他人文件拷进自己资产库。
 * 又是「签了前门(HTTP 端点),漏了侧门(服务端读盘路径)」。现在所有解析方强制走本函数。
 *
 * 服务端内部流转的 serve-file URL(v12.236 起都经 serveFilePathUrl 签发)带签名,能过校验;
 * 攻击者手拼的无签名 URL 一律被拒。
 */
export function resolveVerifiedServeFilePath(serveFileUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(serveFileUrl, 'http://localhost');
  } catch {
    return null;
  }
  const p = u.searchParams.get('path');
  const sig = u.searchParams.get('sig');
  if (!p) return null;
  if (!verifyServeFileSig(p, sig)) return null;
  const resolved = path.resolve(p);
  if (!isServeFilePathAllowed(resolved)) return null;
  if (!fs.existsSync(resolved)) return null;
  return resolved;
}

function serveFileSecret(): string {
  // 复用 JWT_SECRET(生产必设),避免再引一个必配项;可用 SERVE_FILE_SECRET 单独覆盖。
  return process.env.SERVE_FILE_SECRET || process.env.JWT_SECRET || 'dev-insecure-serve-file-secret';
}

function computeSig(absPath: string): string {
  return crypto.createHmac('sha256', serveFileSecret()).update(absPath).digest('hex').slice(0, 32);
}

/** 生成签名版 serve-file URL。所有服务端拼 `?path=` 的地方都应走这里(而非手拼)。 */
export function serveFilePathUrl(absPath: string): string {
  return `/api/serve-file?path=${encodeURIComponent(absPath)}&sig=${computeSig(absPath)}`;
}

/** 校验 `?path=` 的签名(timing-safe)。缺签名或不匹配一律 false。 */
export function verifyServeFileSig(absPath: string, sig: string | null | undefined): boolean {
  if (!sig) return false;
  const expected = computeSig(absPath);
  if (sig.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
