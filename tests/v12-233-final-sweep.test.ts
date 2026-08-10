/**
 * v12.233 — 对抗复检清单收尾回归锁(⑤⑥⑦⑧⑨⑩)。
 *
 * 一条方法论落成测试:**首用户回落**这个模式在整轮加固里被修了三次仍有残留 ——
 * v12.218 修了一批、v12.232 修了一批,本版宽扫才发现实际有 23 处(对抗报告只列了 6 个)。
 * 所以这里不只测「我改的那几个文件」,而是加**全仓不变量**:除已注明的管线内部兜底外,
 * 任何 HTTP 入口都不许再出现首用户回落。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { nanoid } from 'nanoid';
import { listPipelineJobs } from '@/lib/repos/pipeline-job-repo';
import { findCjkFont, isOpenLicenseFont } from '@/lib/text-control';

const ROOT = path.join(__dirname, '..');
const P = 'test-v12233-';

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name === 'route.ts') acc.push(p);
  }
  return acc;
}

describe('v12.233 全仓首用户回落清零(不变量)', () => {
  it('app/api 下没有任何 HTTP 入口再用「DB 第一个用户」兜底', () => {
    const offenders: string[] = [];
    for (const f of walk(path.join(ROOT, 'app', 'api'))) {
      const src = fs.readFileSync(f, 'utf-8');
      if (/FROM users ORDER BY created_at ASC LIMIT 1|FROM users LIMIT 1/.test(src)) {
        offenders.push(path.relative(ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('至少扫到 100 个路由文件(防 walk 坏掉后空跑变假绿)', () => {
    expect(walk(path.join(ROOT, 'app', 'api')).length).toBeGreaterThanOrEqual(100);
  });
});

describe('v12.233 跨租户泄露收口', () => {
  const U1 = `${P}u1-${nanoid(6)}`;
  const U2 = `${P}u2-${nanoid(6)}`;

  function mkJob(userId: string) {
    const id = `${P}job-${nanoid(8)}`;
    db.prepare(
      `INSERT INTO pipeline_jobs (id, type, project_id, user_id, state, step, payload, progress_log, attempts, last_error, heartbeat_at, created_at, updated_at)
       VALUES (?, 'create', ?, ?, 'failed', '', '{"idea":"机密创意"}', '[]', 1, 'x', '', ?, ?)`,
    ).run(id, `${P}proj`, userId, new Date().toISOString(), new Date().toISOString());
    return id;
  }
  beforeEach(() => {
    db.prepare(`DELETE FROM pipeline_jobs WHERE id LIKE '${P}%'`).run();
    mkJob(U1); mkJob(U2);
  });
  afterEach(() => { db.prepare(`DELETE FROM pipeline_jobs WHERE id LIKE '${P}%'`).run(); });

  it('按 userId 过滤 → 只看到自己的任务(此前可枚举全平台)', async () => {
    const jobs = await listPipelineJobs({ userId: U1, limit: 200 });
    const mine = jobs.filter((j) => j.id.startsWith(P));
    expect(mine.length).toBe(1);
    expect(mine[0].userId).toBe(U1);
  });

  it('不传 userId 且不显式 allUsers → 空集(安全默认,绝不泄露)', async () => {
    const jobs = await listPipelineJobs({ limit: 200 });
    expect(jobs.filter((j) => j.id.startsWith(P)).length).toBe(0);
  });

  it('显式 allUsers → 才拿到全量(让跨租户读成为代码里看得见的决定)', async () => {
    const jobs = await listPipelineJobs({ allUsers: true, limit: 200 });
    expect(jobs.filter((j) => j.id.startsWith(P)).length).toBe(2);
  });
});

describe('v12.233 写操作鉴权不对称收口', () => {
  // 这几个路由此前是「GET 有守卫、POST 裸奔」,或身份失败后赋 __no_auth__ 继续执行。
  const CASES: Array<[string, string]> = [
    ['app/api/assets/confirm/route.ts', 'POST'],
    ['app/api/projects/[id]/shot-audio/route.ts', 'POST'],
    ['app/api/projects/[id]/lipsync/render/route.ts', 'POST'],
  ];
  for (const [rel, method] of CASES) {
    it(`${rel} 的 ${method} 有 edit 级项目守卫`, () => {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
      const i = src.indexOf(`export async function ${method}(`);
      expect(i).toBeGreaterThan(-1);
      const body = src.slice(i);
      expect(/requireProjectAccess\([^)]*'edit'\)/.test(body)).toBe(true);
    });
  }

  it('身份失败后不得再出现「赋 __no_auth__ 然后继续跑」的写路径', () => {
    const bad: string[] = [];
    for (const [rel] of CASES) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
      if (/userId = '__no_auth__'/.test(src)) bad.push(rel);
    }
    expect(bad).toEqual([]);
  });
});

describe('v12.233 字体商用合规(🟡-27)', () => {
  it('优先解析到开源可商用字体(而非 macOS 系统字体)', () => {
    const f = findCjkFont();
    // 本机/CI 可能一个 CJK 字体都没有 → null 是合法的(下游 libass 走默认)
    if (f === null) return;
    expect(isOpenLicenseFont(f)).toBe(true);
  });

  it('isOpenLicenseFont 正确识别 macOS 系统字体为「非开源」', () => {
    expect(isOpenLicenseFont('/System/Library/Fonts/PingFang.ttc')).toBe(false);
    expect(isOpenLicenseFont('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')).toBe(true);
  });

  it('源码里开源候选排在系统候选之前(顺序即合规保证)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'text-control.ts'), 'utf-8');
    expect(src.indexOf('OPEN_LICENSE_CJK_FONTS')).toBeLessThan(src.indexOf('SYSTEM_FALLBACK_CJK_FONTS'));
  });
});

describe('v12.233 v1 API 平台级边界', () => {
  it('默认关闭跨租户读取(需显式 API_V1_ALLOW_CROSS_TENANT=1)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app', 'api', 'v1', 'projects', 'route.ts'), 'utf-8');
    expect(src.includes('API_V1_ALLOW_CROSS_TENANT')).toBe(true);
    expect(src.includes('cross_tenant_disabled')).toBe(true);
  });
});
