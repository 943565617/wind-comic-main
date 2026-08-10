#!/usr/bin/env node
/**
 * v12.228 — S3 存储水平扩展冒烟(零外部依赖,不需要真 S3/MinIO)。
 *
 * 补上 lib/storage.ts:167 注释里承诺却一直没写的那个「MinIO 冒烟脚本」。
 *
 * 做法:起一个**最小 S3 兼容端点**(path-style PUT/GET,落到临时目录),把 S3_ENDPOINT 指过去,
 * 然后真跑一遍「写入 → 删本地副本 → 回源」——**故意删掉本地副本来模拟"另一个 Pod"**:
 * 那个 Pod 从没生成过这个文件,本地盘自然没有,只能靠 S3 回源。这正是多 Pod 下
 * `/api/serve-file?key=…` 404 的真实成因。
 *
 * 注意:这里验的是**我们的客户端**(手写 SigV4 的 PUT/GET + ensureLocalCopy 回源逻辑),
 * 所以假端点不校验签名 —— 它只需正确存取字节。签名本身另有 tests/storage.test.ts
 * 用 AWS 官方测试向量逐字节验过。
 *
 * 用法:node scripts/s3-smoke.mjs
 */
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';

const objects = new Map(); // objectKey -> { body: Buffer, contentType: string }
let putCount = 0;
let getCount = 0;

function startFakeS3() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      // path-style: /<bucket>/<objectKey>
      const url = new URL(req.url, `http://${req.headers.host}`);
      const parts = url.pathname.replace(/^\/+/, '').split('/');
      const objectKey = parts.slice(1).join('/');

      if (req.method === 'PUT') {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          objects.set(objectKey, {
            body: Buffer.concat(chunks),
            contentType: req.headers['content-type'] || 'application/octet-stream',
          });
          putCount++;
          res.writeHead(200).end();
        });
        return;
      }
      if (req.method === 'GET') {
        getCount++;
        const obj = objects.get(objectKey);
        if (!obj) { res.writeHead(404).end('NoSuchKey'); return; }
        res.writeHead(200, { 'content-type': obj.contentType, 'content-length': obj.body.length });
        res.end(obj.body);
        return;
      }
      res.writeHead(405).end();
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function ok(cond, label, detail = '') {
  console.log(`${cond ? '  ✅' : '  ❌'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!cond) process.exitCode = 1;
  return cond;
}

const server = await startFakeS3();
const { port } = server.address();

// 必须在 import lib/storage 之前设好 env(s3ConfigFromEnv 每次调用都读 env,这里提前设更稳)
process.env.STORAGE_DRIVER = 's3';
process.env.S3_ENDPOINT = `http://127.0.0.1:${port}`;
process.env.S3_BUCKET = 'smoke-bucket';
process.env.S3_ACCESS_KEY_ID = 'AKIDEXAMPLE';
process.env.S3_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';
delete process.env.S3_PUBLIC_BASE_URL; // 先验私有桶(回源)路径

const { getStorageDriver, ensureLocalCopy, s3GetObject, s3ConfigFromEnv, isS3Mode, LOCAL_STORAGE_ROOT } =
  await import('../lib/storage.ts');

console.log(`\n=== v12.228 S3 冒烟(假端点 :${port},零外部依赖)===\n`);

// ① 驱动识别
const drv = getStorageDriver();
ok(drv.id === 's3', 'STORAGE_DRIVER=s3 → 选中 s3 驱动', `实际 ${drv.id}`);
ok(isS3Mode() === true, 'isS3Mode() 为 true');

// ② 写入:双写本地 + S3
const payload = Buffer.from(`v12.228 smoke payload ${Date.now()}`);
const put = await drv.put('smoke' + 'a'.repeat(27), '.mp4', payload, 'video/mp4');
ok(put.driver === 's3', '写入走 s3 驱动');
ok(fs.existsSync(put.absPath), '本地副本已落盘(ffmpeg 消费方契约)', put.absPath);
ok(putCount === 1, 'S3 收到 1 次 PUT', `实际 ${putCount}`);

// ③ S3 GET 能取回同样字节(验手写 SigV4 GET 通路)
const fetched = await s3GetObject(s3ConfigFromEnv(), `${put.key}${put.ext}`);
ok(fetched !== null && fetched.equals(payload), 'S3 GET 取回字节与写入一致');

// ④ 关键场景:删本地副本 = 模拟"另一个 Pod"(它从没生成过这文件)
fs.unlinkSync(put.absPath);
ok(!fs.existsSync(put.absPath), '已删本地副本(模拟另一个 Pod 的空盘)');

// ⑤ 回源:ensureLocalCopy 必须从 S3 拉回来
const before = getCount;
const recovered = await ensureLocalCopy(put.key, put.ext);
ok(recovered !== null, 'ensureLocalCopy 回源成功', String(recovered));
ok(getCount > before, '确实发生了 S3 GET(不是悄悄用了别的本地文件)', `GET ${before}→${getCount}`);
ok(fs.existsSync(put.absPath), '本地副本已恢复 —— 此后 ffmpeg 按 absPath 读照常可用');
ok(fs.readFileSync(put.absPath).equals(payload), '回源内容与原始字节一致');

// ⑥ 不存在的 key → 回源返回 null(不该抛错,也不该造出空文件)
const missing = await ensureLocalCopy('deadbeef'.repeat(4), '.mp4');
ok(missing === null, '不存在的 key → ensureLocalCopy 返回 null(而非抛错/空文件)');

// ⑦ 单机回归:未配 S3 时 ensureLocalCopy 不发任何网络请求
const savedDriver = process.env.STORAGE_DRIVER;
delete process.env.STORAGE_DRIVER;
const g0 = getCount;
const localOnly = await ensureLocalCopy('cafebabe'.repeat(4), '.mp4');
ok(localOnly === null && getCount === g0, '未配 S3(单机)→ 不回源、不发请求(零行为变化)');
process.env.STORAGE_DRIVER = savedDriver;

// 清理
try { fs.unlinkSync(put.absPath); } catch { /* 已删则忽略 */ }
server.close();

console.log(`\n${process.exitCode ? '❌ 冒烟失败' : '✅ 冒烟全部通过'}\n`);
