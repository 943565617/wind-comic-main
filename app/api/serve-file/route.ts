import { NextRequest, NextResponse } from 'next/server';
import { safeFetch } from '@/lib/ssrf-guard';
import { verifyServeFileSig } from '@/lib/serve-file-sign';
import { requireUser } from '@/lib/auth-guard';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolveByKey, resolveByKeyOrFetch } from '@/lib/asset-storage';
import { isS3Mode, s3PublicUrl } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/serve-file
 * 支持三种模式:
 *   1) ?key=<sha256>              持久化资产(v2.9+),服务 data/storage/assets/ 下的文件
 *   2) ?path=/tmp/xxx/final.mp4   兼容 v2.8 及之前的 /tmp 临时路径
 *   3) ?proxy=<http-url>          外链代理(Midjourney/Minimax 过期 CDN 的兜底)
 *
 * v12.234(二轮对抗复检 · CRITICAL)三个模式的鉴权语义是**有意分开**的:
 *   · `?key=` **保持公开** —— key 是内容寻址的 SHA-256,本身即「不可猜的能力 URL」;
 *     且 lip-sync 等外部引擎必须能用公网直链回源拉片,加 Bearer 会直接打断该链路。
 *     这是一个**权衡后的决定**,不是遗漏:安全性来自 key 的不可枚举性,不是来自登录态。
 *   · `?path=` **要求登录** —— 它能读 data/composed 等目录下**任意用户**的成片/图/音,
 *     此前完全裸奔。服务端消费方(video-composer 等)是同进程直接读本地路径、不走 HTTP,
 *     浏览器侧则自带会话 cookie,所以加鉴权对现有链路零影响。
 *   · `?proxy=` **要求登录 + SSRF 守卫** —— 全仓**零调用方**,当前纯属攻击面:
 *     原正则只拦 127./10./192.168./172.16-31./localhost,漏掉云元数据 169.254.169.254、
 *     IPv6 回环、各种进制编码 IP 和「解析到内网的域名」。现改用 lib/ssrf-guard 做字面量+DNS 双层判定。
 */
export async function GET(request: NextRequest) {
  const keyParam = request.nextUrl.searchParams.get('key');
  const filePath = request.nextUrl.searchParams.get('path');
  const proxyUrl = request.nextUrl.searchParams.get('proxy');

  // ── 模式 1: 持久化资产 ──
  if (keyParam) {
    // v12.228(存储水平扩展 · 🟠-18):本地命中就直接服务(单机永远走这条,零行为变化)。
    // 多 Pod + S3 时本地可能没有 —— 写侧虽双写本地,但本地副本**只在生成它的那个 Pod**,
    // 负载均衡打到别的 Pod 就 404。此时按需回源:
    //   · 配了 S3_PUBLIC_BASE_URL → 302 到公网直链(省一次回源流量,CDN 友好);
    //   · 否则(私有桶)→ 从 S3 拉一份落本地再服务,顺带让本 Pod 的 ffmpeg 消费方也能用。
    const local = resolveByKey(keyParam);
    if (local) return serveLocalFile(request, local.absPath);

    if (isS3Mode()) {
      const resolved = await resolveByKeyOrFetch(keyParam);
      if (resolved) {
        const publicUrl = s3PublicUrl(`${keyParam}${resolved.ext}`);
        if (publicUrl) return NextResponse.redirect(publicUrl, 302);
        return serveLocalFile(request, resolved.absPath);
      }
    }
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  }

  // ── 模式 3: 外链代理(只代理 http/https,流式转发) ──
  if (proxyUrl) {
    const _g = await requireUser(request);
    if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      // v12.235:改用 safeFetch —— v12.234 只在发请求**前**校验一次 URL,而 fetch 默认跟随 302,
      // 攻击者用自己控制的公网地址 302 到 169.254.169.254 就能完整绕过守卫。safeFetch 逐跳重验。
      let upstream: Response;
      try {
        upstream = await safeFetch(proxyUrl, {
          signal: controller.signal,
          headers: { 'User-Agent': 'ai-comic-studio-asset-proxy/1.0' },
        });
      } catch (e) {
        clearTimeout(timer);
        const msg = e instanceof Error ? e.message : 'unknown';
        console.warn(`[serve-file] SSRF 拦截 user=${_g.userId} url=${proxyUrl} → ${msg}`);
        return NextResponse.json({ error: `Blocked: ${msg}` }, { status: 403 });
      }
      clearTimeout(timer);
      if (!upstream.ok) {
        return NextResponse.json({ error: `Upstream ${upstream.status}` }, { status: upstream.status });
      }
      const ct = upstream.headers.get('content-type') || 'application/octet-stream';
      const cl = upstream.headers.get('content-length');
      return new Response(upstream.body, {
        status: 200,
        headers: {
          'Content-Type': ct,
          ...(cl ? { 'Content-Length': cl } : {}),
          'Cache-Control': 'public, max-age=3600', // 浏览器端缓存 1h
        },
      });
    } catch (e) {
      return NextResponse.json({ error: `Proxy failed: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 });
    }
  }

  // ── 模式 2: 本地路径白名单 ──
  if (!filePath) {
    return NextResponse.json({ error: 'Missing path / key / proxy parameter' }, { status: 400 });
  }

  // v2.22 fix: 允许 4 个目录:
  //   1) /tmp (v2.8 及之前老成片, 现在大多失效)
  //   2) data/composed (v2.18.1+ 持久化最终成片, 之前被 403 → 用户看到"本地合成视频文件已失效")
  //   3) data/exports (v2.16 P0.2 多分辨率 mp4)
  //   4) data/storage (持久化资产, 兜底)
  // 防 path traversal: 必须以这些前缀开头, 且不含 '..'.
  const _gp = await requireUser(request);
  if (!_gp.ok) return NextResponse.json({ message: _gp.message }, { status: _gp.status });

  // v12.236(第三轮对抗复检 · 跨用户 IDOR):仅「登录 + 目录白名单」挡不住越权 ——
  // 成片名是 final-<时间戳>.mp4,任何登录用户拿到路径(SSE/日志泄露)即可读他人成片。
  // 现在要求 HMAC 签名:URL 必须是服务端经 serveFilePathUrl() 签发过的,伪造不了签名就 403。
  const sig = request.nextUrl.searchParams.get('sig');
  if (!verifyServeFileSig(filePath, sig)) {
    console.warn(`[serve-file] path= 未签名/签名无效 user=${_gp.userId} path=${filePath.slice(0, 80)}`);
    return NextResponse.json({ error: 'Unsigned or invalid path signature' }, { status: 403 });
  }

  const resolvedPath = path.resolve(filePath);
  const cwd = process.cwd();
  const allowedPrefixes = [
    os.tmpdir(),
    path.join(cwd, 'data', 'composed'),
    path.join(cwd, 'data', 'exports'),
    path.join(cwd, 'data', 'storage'),
    path.join(cwd, 'data', 'media'),   // v12.124:TTS 音频 / 生成图像持久目录(替代 os.tmpdir 防 GC 404)
    path.join(cwd, 'data', 'covers'),  // v12.113:成片抽帧封面
  ];
  const isAllowed = allowedPrefixes.some((p) => resolvedPath.startsWith(path.resolve(p)));
  if (!isAllowed) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  if (!fs.existsSync(resolvedPath)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  return serveLocalFile(request, resolvedPath);
}

/**
 * 服务本地文件(统一处理 Range + content-type + safe stream)。
 */
function serveLocalFile(request: NextRequest, resolvedPath: string): Response {
  const stat = fs.statSync(resolvedPath);
  const ext = path.extname(resolvedPath).toLowerCase();

  const mimeTypes: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.aac': 'audio/aac',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';

  // 支持 Range 请求（视频播放需要）
  const range = request.headers.get('range');

  /**
   * 创建一个安全包装的 ReadableStream，能正确处理浏览器中断/range 请求取消的情况
   * 关键修复：避免 "Invalid state: Controller is already closed" 崩溃
   */
  function createSafeReadableStream(nodeStream: fs.ReadStream): ReadableStream {
    let closed = false;

    const safeClose = (controller: ReadableStreamDefaultController) => {
      if (closed) return;
      closed = true;
      try {
        controller.close();
      } catch {
        /* controller 已被外部关闭，忽略 */
      }
    };

    const safeError = (controller: ReadableStreamDefaultController, err: unknown) => {
      if (closed) return;
      closed = true;
      try {
        controller.error(err);
      } catch {
        /* 忽略二次关闭错误 */
      }
    };

    return new ReadableStream({
      start(controller) {
        nodeStream.on('data', (chunk) => {
          if (closed) {
            // 浏览器已断开，停止读取
            nodeStream.destroy();
            return;
          }
          try {
            controller.enqueue(chunk);
          } catch {
            // controller 已关闭（例如浏览器中断 range 请求），销毁 fs stream
            closed = true;
            nodeStream.destroy();
          }
        });
        nodeStream.on('end', () => safeClose(controller));
        nodeStream.on('error', (err) => safeError(controller, err));
        nodeStream.on('close', () => safeClose(controller));
      },
      cancel() {
        // 浏览器主动取消（seek / 切换视频），立刻销毁底层 fs stream
        closed = true;
        nodeStream.destroy();
      },
    });
  }

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunkSize = end - start + 1;

    const stream = fs.createReadStream(resolvedPath, { start, end });
    const readableStream = createSafeReadableStream(stream);

    return new Response(readableStream, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
      },
    });
  }

  // 完整文件响应
  const stream = fs.createReadStream(resolvedPath);
  const readableStream = createSafeReadableStream(stream);

  return new Response(readableStream, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `inline; filename="${path.basename(resolvedPath)}"`,
      'Cache-Control': 'no-cache',
    },
  });
}
