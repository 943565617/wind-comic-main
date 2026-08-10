/**
 * v2.22 fix #3 — serve-file allow data/composed + data/exports + data/storage,
 * 同时锁死 /etc /tmp 之外的随机路径 (security).
 *
 * v12.234:`?path=` 模式改为**要求登录**(此前完全裸奔,可匿名读任意用户的成片/图/音)。
 * 因此这些「路径白名单」用例现在都得先有身份 —— 这里 mock auth-guard 让 requireUser 通过,
 * 保持本文件的关注点仍是**路径白名单本身**;鉴权与否另有一条独立用例守着(见文件末尾)。
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('@/lib/auth-guard', () => ({
  requireUser: vi.fn(async () => ({ ok: true, userId: 'u-test-serve-file' })),
}));

// 不 mock asset-storage — 直接走真路径
const { GET } = await import('@/app/api/serve-file/route');
const { requireUser } = await import('@/lib/auth-guard');
const { serveFilePathUrl } = await import('@/lib/serve-file-sign');

// v12.236:?path= 现在要求 HMAC 签名(能力 URL)。这些「白名单/存在性」用例本身不测签名,
// 用 signed() 生成合法签名 query,让关注点仍是白名单;签名的正/负路径另有独立用例守(见文件末尾)。
function signed(absPath: string): string {
  return serveFilePathUrl(absPath).replace('/api/serve-file?', '');
}

function mkReq(qs: string): any {
  const url = new URL(`http://localhost:3000/api/serve-file?${qs}`);
  return {
    nextUrl: url,
    headers: { get: () => null },
  };
}

describe('v2.22 fix #3 · serve-file path allowlist', () => {
  it('允许 data/composed 下的文件 (200 or 404 if 缺)', async () => {
    const composedDir = path.join(process.cwd(), 'data', 'composed');
    if (!fs.existsSync(composedDir)) fs.mkdirSync(composedDir, { recursive: true });
    const testFile = path.join(composedDir, 'test-v2-22-allowlist.mp4');
    fs.writeFileSync(testFile, 'fake mp4');
    try {
      const req = mkReq(signed(testFile));
      const res = await GET(req);
      expect(res.status).toBe(200);
    } finally {
      fs.unlinkSync(testFile);
    }
  });

  it('允许 data/exports 下的文件', async () => {
    const dir = path.join(process.cwd(), 'data', 'exports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const testFile = path.join(dir, 'test-v2-22-allowlist.mp4');
    fs.writeFileSync(testFile, 'fake mp4');
    try {
      const req = mkReq(signed(testFile));
      const res = await GET(req);
      expect(res.status).toBe(200);
    } finally {
      fs.unlinkSync(testFile);
    }
  });

  it('允许 /tmp 路径 (legacy)', async () => {
    const tmp = path.join(os.tmpdir(), 'test-v2-22-tmp.mp4');
    fs.writeFileSync(tmp, 'fake');
    try {
      const req = mkReq(signed(tmp));
      const res = await GET(req);
      expect(res.status).toBe(200);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('拒绝 /etc/passwd (path traversal block)', async () => {
    const req = mkReq(signed('/etc/passwd'));
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('拒绝 data/composed/../../etc/passwd (resolved path traversal)', async () => {
    const evil = path.join(process.cwd(), 'data', 'composed', '..', '..', '..', 'etc', 'passwd');
    const req = mkReq(signed(evil));
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('合法目录但文件不存在 → 404', async () => {
    const missing = path.join(process.cwd(), 'data', 'composed', 'nope-' + Date.now() + '.mp4');
    const req = mkReq(signed(missing));
    const res = await GET(req);
    expect(res.status).toBe(404);
  });

  it('缺 path/key/proxy 参数 → 400', async () => {
    const req = mkReq('');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
});

describe('v12.234 · serve-file 鉴权(?path= 不再裸奔)', () => {
  it('未登录访问 ?path= → 401,且不泄露文件是否存在', async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({ ok: false, status: 401, message: '未登录' } as any);
    const target = path.join(process.cwd(), 'data', 'composed', 'whatever.mp4');
    const res = await GET(mkReq(`path=${encodeURIComponent(target)}`));
    expect(res.status).toBe(401);
  });

  it('未登录访问 ?proxy= → 401(该模式全仓零调用方,纯攻击面)', async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({ ok: false, status: 401, message: '未登录' } as any);
    const res = await GET(mkReq(`proxy=${encodeURIComponent('https://example.com/a.png')}`));
    expect(res.status).toBe(401);
  });

  it('已登录但代理指向云元数据地址 → 403(旧正则放行的那个漏网之鱼)', async () => {
    const res = await GET(mkReq(`proxy=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}`));
    expect(res.status).toBe(403);
  });
});

describe('v12.236 · serve-file ?path= 签名门(跨用户 IDOR)', () => {
  it('已登录但 URL 未签名(攻击者手拼路径)→ 403', async () => {
    const target = require('path').join(process.cwd(), 'data', 'composed', 'someone-elses.mp4');
    const res = await GET(mkReq(`path=${encodeURIComponent(target)}`)); // 故意不带 sig
    expect(res.status).toBe(403);
  });

  it('已登录 + 伪造签名 → 403', async () => {
    const target = require('path').join(process.cwd(), 'data', 'composed', 'x.mp4');
    const res = await GET(mkReq(`path=${encodeURIComponent(target)}&sig=${'0'.repeat(32)}`));
    expect(res.status).toBe(403);
  });
});
