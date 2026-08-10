/**
 * v12.237 — 第四轮独立对抗复检的修复回归锁。
 *
 * 这一轮最狠的一条(CRITICAL)又是同一个病:v12.236 给 serve-file 的 **HTTP 端点**加了签名,
 * 却漏了两条**服务端本地读盘路径** —— `asset-storage.persistAsset` 与 `first-frame.serveFileToLocalPath`,
 * 它们遇到 `?path=` 时用 URLSearchParams 取值直接 readFileSync,不经 HTTP 层、不验签、无白名单。
 * cameo / pull-sheet / video-anchor 三个入口把用户 body 的 imageUrl/videoUrl 原样喂进来 ——
 * 「签了前门,漏了侧门」。修的过程中又发现 persistAsset 的**裸路径 fallback** 是同一扇门的第三个入口。
 *
 * 另一条 HIGH:v12.236 的 embeddedIpv4 只查 g[6,7],漏了 6to4(2002::/16)把 IPv4 编在 g[1,2]。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { isBlockedIp, embeddedIpv4, assertOutboundUrlSafe } from '@/lib/ssrf-guard';
import {
  serveFilePathUrl,
  resolveVerifiedServeFilePath,
  isServeFilePathAllowed,
} from '@/lib/serve-file-sign';

const ROOT = path.join(__dirname, '..');

describe('v12.237 SSRF · 6to4(2002::/16)也拦(HIGH 回归)', () => {
  it('6to4 编码的内网/元数据地址被拦', () => {
    const cases: Array<[string, string]> = [
      ['2002:a9fe:a9fe::', '169.254.169.254 云 IMDS'],
      ['2002:7f00:1::', '127.0.0.1'],
      ['2002:0a00:1::', '10.0.0.1'],
      ['2002:c0a8:101::', '192.168.1.1'],
      ['2002:ac10:1::', '172.16.0.1'],
    ];
    for (const [ip, desc] of cases) {
      expect(embeddedIpv4(ip), `${ip} 应解出内嵌 v4`).toBeTruthy();
      expect(isBlockedIp(ip), `${ip}(${desc})必须被拦`).toBe(true);
    }
  });

  it('公网 6to4 不误杀(2002:0808:0808:: → 8.8.8.8)', () => {
    expect(isBlockedIp('2002:0808:0808::')).toBe(false);
  });

  it('端到端:代理指向 6to4 IMDS → 拒', async () => {
    const v = await assertOutboundUrlSafe('http://[2002:a9fe:a9fe::]/latest/meta-data/');
    expect(v.ok).toBe(false);
  });
});

describe('v12.237 serve-file 本地解析路径必须验签(CRITICAL)', () => {
  let real: string;
  beforeAll(() => {
    real = path.join(process.cwd(), 'data', 'composed', '_v237test.mp4');
    fs.mkdirSync(path.dirname(real), { recursive: true });
    fs.writeFileSync(real, 'test-content');
  });
  afterAll(() => { try { fs.unlinkSync(real); } catch { /* noop */ } });

  it('合法签名 URL → 解析出本地路径', () => {
    expect(resolveVerifiedServeFilePath(serveFilePathUrl(real))).toBe(path.resolve(real));
  });

  it('攻击者手拼的无签名 ?path= → null(cameo/pull-sheet/video-anchor 的攻击被堵)', () => {
    expect(resolveVerifiedServeFilePath('/api/serve-file?path=' + encodeURIComponent(real))).toBeNull();
  });

  it('伪造签名 → null', () => {
    expect(resolveVerifiedServeFilePath('/api/serve-file?path=' + encodeURIComponent(real) + '&sig=' + '0'.repeat(32))).toBeNull();
  });

  it('白名单外文件即便签名也拒(双层)', () => {
    expect(resolveVerifiedServeFilePath(serveFilePathUrl('/etc/passwd'))).toBeNull();
  });

  it('.. 逃逸即便签名也拒', () => {
    const escape = path.join(process.cwd(), 'data', 'composed', '..', '..', 'etc', 'passwd');
    expect(resolveVerifiedServeFilePath(serveFilePathUrl(escape))).toBeNull();
  });
});

describe('v12.237 裸本地路径 fallback 白名单(persistAsset else 分支)', () => {
  it('白名单外裸路径被拒', () => {
    expect(isServeFilePathAllowed('/etc/passwd')).toBe(false);
    expect(isServeFilePathAllowed('/root/.ssh/id_rsa')).toBe(false);
  });
  it('白名单内路径放行(内部合法流转不误伤)', () => {
    expect(isServeFilePathAllowed(path.join(process.cwd(), 'data', 'composed', 'x.mp4'))).toBe(true);
    expect(isServeFilePathAllowed(path.join(os.tmpdir(), 'y.mp4'))).toBe(true);
  });
  it('前缀相邻目录不算命中(data/composed-evil 不该被 data/composed 前缀放行)', () => {
    expect(isServeFilePathAllowed(path.join(process.cwd(), 'data', 'composed-evil', 'x'))).toBe(false);
  });
});

describe('v12.237 两条本地解析路径与 cameo 都已加固(源码锁)', () => {
  it('asset-storage 的 ?path= 分支走 resolveVerifiedServeFilePath', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'asset-storage.ts'), 'utf-8');
    expect(src.includes('resolveVerifiedServeFilePath')).toBe(true);
    // 裸路径 fallback 也要白名单
    expect(src.includes('isServeFilePathAllowed')).toBe(true);
  });
  it('first-frame 的 ?path= 分支走 resolveVerifiedServeFilePath', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'first-frame.ts'), 'utf-8');
    expect(src.includes('resolveVerifiedServeFilePath')).toBe(true);
  });
  it('cameo 的 imageUrl 有协议白名单', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app', 'api', 'projects', '[id]', 'cameo', 'route.ts'), 'utf-8');
    const i = src.indexOf('persistInputUrl = body.imageUrl');
    expect(/https\?:\|data:\|\\\/api\\\/serve-file|https\?:.*serve-file/.test(src.slice(Math.max(0, i - 400), i))).toBe(true);
  });
});
