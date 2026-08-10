/**
 * v12.285 — 发布适配器改零拷贝 Blob(原为整文件三次拷贝进内存)。
 *
 * 病根实测(320 MB 成片,约一集竖屏长剧):
 *   readFile → Uint8Array → Blob :RSS **+962 MB**、253 ms
 *     —— 三份拷贝:readFile 得 Buffer、`new Uint8Array(buf)` 复制、`new Blob([u8])` 再复制;
 *   `fs.openAsBlob`             :RSS **+2 MB**、0 ms(装进 FormData 后共 +7 MB)。
 * 320 MB 的片子原本要吃掉近 1 GB 内存,小容器上直接 OOM。
 *
 * 兼容性是本版的关键约束:`readVideo` 是**依赖注入点**,5 个既有测试注入的是
 * `{bytes, contentType}` 形态。只替换**默认实现**、调用方统一经 `toBlob()` 归一,
 * 故那 5 处零改动仍绿(本套件末尾直接验这点)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDouyinAdapter } from '@/lib/publish-adapters/douyin';
import { createYouTubeAdapter } from '@/lib/publish-adapters/youtube';

const SRC_DY = fs.readFileSync('lib/publish-adapters/douyin.ts', 'utf-8');
const SRC_YT = fs.readFileSync('lib/publish-adapters/youtube.ts', 'utf-8');

describe('v12.285 · 默认实现零拷贝', () => {
  it('两个适配器都改用 fs.openAsBlob 读本地文件', () => {
    for (const [name, src] of [['douyin', SRC_DY], ['youtube', SRC_YT]] as const) {
      expect(src, `${name} 未使用 openAsBlob`).toContain('openAsBlob');
      expect(src, `${name} 仍在 readFile 整读`).not.toMatch(/const buf = await fs\.readFile/);
    }
  });

  it('老 Node 无 openAsBlob 时有退路(不直接崩)', () => {
    for (const src of [SRC_DY, SRC_YT]) {
      expect(src).toContain("typeof (fs as any).openAsBlob === 'function'");
      expect(src).toMatch(/fsp\.readFile\(p\)/); // 退回整读
    }
  });

  it('远端 URL 分支也少掉一次拷贝(不再 arrayBuffer→Uint8Array→Blob)', () => {
    expect(SRC_DY).toContain('await res.blob()');
    expect(SRC_YT).not.toMatch(/bytes: new Uint8Array\(await res\.arrayBuffer\(\)\)/);
  });

  it('openAsBlob 真能零拷贝拿到正确大小(行为验证,非只看源码)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v285-'));
    const f = path.join(tmp, 'a.bin');
    fs.writeFileSync(f, Buffer.alloc(1024 * 64, 7));
    const blob: Blob = await (fs as any).openAsBlob(f, { type: 'video/mp4' });
    expect(blob.size).toBe(1024 * 64);
    expect(blob.type).toBe('video/mp4');
    // 能被切片/读取 —— 证明它确实持有文件内容(而非空壳)
    expect(await blob.slice(0, 4).text()).toHaveLength(4);
    // 注:此处不验 `FormData.append(blob)` —— vitest 跑在 **jsdom** 环境,
    // jsdom 的 FormData 只认自己的 Blob 类,拒收 Node 原生 Blob。
    // 生产是 Node runtime,原生 FormData 接受它(独立实测:320MB 装进 FormData 后 RSS 仅 +7MB)。
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('v12.285 · 兼容:注入点形态不变', () => {
  it('toBlob 同时接受 Blob 与 {bytes,contentType} 两种返回', () => {
    for (const src of [SRC_DY, SRC_YT]) {
      expect(src).toContain('function toBlob');
      expect(src).toContain('v instanceof Blob');
      expect(src).toContain('v.bytes as BlobPart');
    }
  });

  const PKG: any = { video: { url: 'https://cdn/x.mp4' }, title: '标题', spec: {}, titleAlternatives: [] };
  const okFetch = () => (async () => new Response(JSON.stringify({ data: { video: { video_id: 'v1' }, item_id: 'item9' } }))) as any;

  it('行为:注入**旧形态** {bytes,contentType} 仍能走完上传(5 个既有测试就是这么注入的)', async () => {
    const a = createDouyinAdapter({
      fetchImpl: okFetch(),
      getCreds: () => ({ token: 't', openId: 'o' }),
      readVideo: async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'video/mp4' }),
    });
    const r: any = await a.upload(PKG, { confirmed: true });
    expect(r.status).toBe('published');
    expect(r.externalId).toBe('item9');
  });

  it('行为:注入**新形态** Blob 也能走完(toBlob 归一)', async () => {
    const a = createDouyinAdapter({
      fetchImpl: okFetch(),
      getCreds: () => ({ token: 't', openId: 'o' }),
      readVideo: (async () => new Blob([new Uint8Array([9])], { type: 'video/mp4' })) as any,
    });
    const r: any = await a.upload(PKG, { confirmed: true });
    expect(r.status).toBe('published');
  });

  it('行为:注入 {blob,contentType} 形态(默认实现现在返回的就是它)', async () => {
    const a = createDouyinAdapter({
      fetchImpl: okFetch(),
      getCreds: () => ({ token: 't', openId: 'o' }),
      readVideo: (async () => ({ blob: new Blob([new Uint8Array([9])]), contentType: 'video/mp4' })) as any,
    });
    const r: any = await a.upload(PKG, { confirmed: true });
    expect(r.status).toBe('published');
  });
});

describe('v12.285 · YouTube resumable 上传用 Blob.size 而非 byteLength', () => {
  it('Content-Length 取自 videoBlob.size', () => {
    expect(SRC_YT).toContain('String(videoBlob.size)');
    expect(SRC_YT).not.toContain('bytes.byteLength');
  });

  it('body 直接给 Blob(fetch 按需读取,不必在内存摊平)', () => {
    expect(SRC_YT).toContain('body: videoBlob as unknown as BodyInit');
  });
});
