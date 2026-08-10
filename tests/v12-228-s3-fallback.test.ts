/**
 * v12.228 — 存储水平扩展回归锁(🟠-18 多 Pod serve-file 404)。
 *
 * 真实失效场景(侦察后校正过的,不是路线图字面写的那个):写侧一直**双写本地 + S3**,
 * 所以"仅 S3 没有本地副本"在单机根本不会发生 —— 它只发生在**多 Pod**:
 * Pod-A 生成并写盘,Pod-B 本地盘从来没有这个文件,而 `resolveByKey` 只 readdir 本地 → 404。
 * 本测试锁住新增的回源通路,以及最要紧的一条:**单机路径零行为变化、零额外网络请求**。
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { s3GetObject, ensureLocalCopy, isS3Mode, s3PublicUrl, s3ConfigFromEnv, storagePut, LOCAL_STORAGE_ROOT } from '@/lib/storage';
import { resolveByKeyOrFetch } from '@/lib/asset-storage';

const S3_ENV = ['STORAGE_DRIVER', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_BASE_URL'] as const;
let saved: Record<string, string | undefined> = {};

function setS3Env() {
  process.env.STORAGE_DRIVER = 's3';
  process.env.S3_ENDPOINT = 'http://127.0.0.1:9000';
  process.env.S3_BUCKET = 'qfmj';
  process.env.S3_ACCESS_KEY_ID = 'ak';
  process.env.S3_SECRET_ACCESS_KEY = 'sk';
  delete process.env.S3_PUBLIC_BASE_URL;
}

beforeEach(() => {
  saved = {};
  for (const k of S3_ENV) saved[k] = process.env[k];
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of S3_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
});

describe('v12.228 s3GetObject(手写 SigV4 GET)', () => {
  it('200 → 返回字节', async () => {
    setS3Env();
    const payload = Buffer.from('hello-s3');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(payload), { status: 200 })));
    const got = await s3GetObject(s3ConfigFromEnv()!, 'abc.mp4');
    expect(got).not.toBeNull();
    expect(got!.equals(payload)).toBe(true);
  });

  it('404 → 返回 null(缺对象不是异常)', async () => {
    setS3Env();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('NoSuchKey', { status: 404 })));
    expect(await s3GetObject(s3ConfigFromEnv()!, 'nope.mp4')).toBeNull();
  });

  it('403 → 也返回 null(私有桶/权限问题当作"没有",不炸调用方)', async () => {
    setS3Env();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('AccessDenied', { status: 403 })));
    expect(await s3GetObject(s3ConfigFromEnv()!, 'x.mp4')).toBeNull();
  });

  it('500 → 抛错(真故障要冒泡,不能静默当成缺文件)', async () => {
    setS3Env();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    await expect(s3GetObject(s3ConfigFromEnv()!, 'x.mp4')).rejects.toThrow(/S3 GET 500/);
  });

  it('GET 请求带 SigV4 Authorization 头(签的是空 payload 的 sha256)', async () => {
    setS3Env();
    const spy = vi.fn(async () => new Response(new Uint8Array(Buffer.from('x')), { status: 200 }));
    vi.stubGlobal('fetch', spy);
    await s3GetObject(s3ConfigFromEnv()!, 'k.mp4');
    const init = spy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe('GET');
    expect(String(headers.authorization)).toMatch(/^AWS4-HMAC-SHA256 Credential=ak\//);
    // 空 body 的 sha256(AWS 规定 GET 用这个常量)
    expect(headers['x-amz-content-sha256']).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('v12.228 ensureLocalCopy 按需回源', () => {
  it('本地已有 → 直接返回,不发任何网络请求(单机路径,零开销)', async () => {
    delete process.env.STORAGE_DRIVER;
    const body = Buffer.from(`local-hit-${Math.PI}`);
    const put = await storagePut(body, 'image/png', '.png');
    const spy = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', spy);
    const abs = await ensureLocalCopy(put.key, '.png');
    expect(abs).toBe(put.absPath);
    expect(spy).not.toHaveBeenCalled(); // 关键:单机不因这次改动多打一次网络
  });

  it('本地缺失 + 未配 S3 → null,且不发请求', async () => {
    delete process.env.STORAGE_DRIVER;
    const spy = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', spy);
    expect(await ensureLocalCopy('f'.repeat(32), '.mp4')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('本地缺失 + 配了 S3 → 回源落盘,内容一致', async () => {
    setS3Env();
    const payload = Buffer.from(`from-s3-${Date.now()}`);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(payload), { status: 200 })));
    const key = 'a1b2c3d4'.repeat(4);
    const abs = await ensureLocalCopy(key, '.mp4');
    try {
      expect(abs).not.toBeNull();
      expect(fs.existsSync(abs!)).toBe(true);
      expect(fs.readFileSync(abs!).equals(payload)).toBe(true);
    } finally {
      if (abs && fs.existsSync(abs)) fs.unlinkSync(abs);
    }
  });

  it('S3 也没有 → null,且不留空文件(半截文件比没文件更糟)', async () => {
    setS3Env();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('NoSuchKey', { status: 404 })));
    const key = 'b'.repeat(32);
    expect(await ensureLocalCopy(key, '.mp4')).toBeNull();
    expect(fs.existsSync(path.join(LOCAL_STORAGE_ROOT, `${key}.mp4`))).toBe(false);
  });

  it('S3 抛错 → 吞掉返回 null(回源失败不该让 serve-file 500)', async () => {
    setS3Env();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    expect(await ensureLocalCopy('c'.repeat(32), '.mp4')).toBeNull();
  });
});

describe('v12.228 isS3Mode / s3PublicUrl', () => {
  it('未配 → 非 S3 模式,无公网直链', () => {
    delete process.env.STORAGE_DRIVER;
    expect(isS3Mode()).toBe(false);
    expect(s3PublicUrl('x.mp4')).toBeNull();
  });

  it('配齐但无 PUBLIC_BASE_URL → S3 模式,但无公网直链(私有桶走回源)', () => {
    setS3Env();
    expect(isS3Mode()).toBe(true);
    expect(s3PublicUrl('x.mp4')).toBeNull();
  });

  it('配了 PUBLIC_BASE_URL → 给出直链(serve-file 据此 302,省回源流量)', () => {
    setS3Env();
    process.env.S3_PUBLIC_BASE_URL = 'https://cdn.example.com/assets/';
    expect(s3PublicUrl('x.mp4')).toBe('https://cdn.example.com/assets/x.mp4');
  });
});

describe('v12.228 resolveByKeyOrFetch', () => {
  it('本地命中 → 与 resolveByKey 等价(单机零行为变化)', async () => {
    delete process.env.STORAGE_DRIVER;
    const body = Buffer.from(`resolve-${Math.LN2}`);
    const put = await storagePut(body, 'video/mp4', '.mp4');
    const r = await resolveByKeyOrFetch(put.key);
    expect(r?.absPath).toBe(put.absPath);
    expect(r?.ext).toBe('.mp4');
  });

  it('非法 key → null(不触发任何回源尝试)', async () => {
    setS3Env();
    const spy = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', spy);
    expect(await resolveByKeyOrFetch('../etc/passwd')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
