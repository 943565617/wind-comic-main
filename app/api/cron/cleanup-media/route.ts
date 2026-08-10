/**
 * GET/POST /api/cron/cleanup-media (v12.191) — 媒体定时清理。
 *
 * data/ 已累积 3.5GB(用户磁盘之痛的一半根源):storage 30 天、composed/exports 7 天、
 * media(images/audio/videos)14 天 —— **只删「有持久引用保护之外」的过期文件**?
 * 保守起见:composed 成片可再合成、exports 可再导出、media 中间物可再生 —— 按 mtime 清;
 * storage(persistAsset 注册表)walk 现有 cleanup()。带 CRON_SECRET 校验(env 未设则仅本机)。
 * 干跑:?dryRun=1 只报告不删。
 */
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { cleanup } from '@/lib/asset-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sweepDir(dir: string, maxAgeDays: number, dryRun: boolean): { removed: number; freedMB: number } {
  let removed = 0, freed = 0;
  try {
    if (!fs.existsSync(dir)) return { removed: 0, freedMB: 0 };
    const cutoff = Date.now() - maxAgeDays * 24 * 3600 * 1000;
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        const st = fs.statSync(p);
        if (st.isDirectory()) { walk(p); continue; }
        if (st.mtimeMs < cutoff) {
          freed += st.size;
          if (!dryRun) fs.unlinkSync(p);
          removed++;
        }
      }
    };
    walk(dir);
  } catch { /* 单目录失败不阻塞其他 */ }
  return { removed, freedMB: Math.round(freed / 1024 / 1024) };
}

async function handle(request: Request) {
  const url = new URL(request.url);
  // v12.234(二轮对抗复检 · HIGH):原写 `if (secret && ...)` —— **CRON_SECRET 未设时整个守卫被短路**,
  // 匿名 GET 一下就按 mtime 批量删 data/composed / exports / media 里的成片。
  // 兄弟端点 run-scheduled-publishes 早就是「生产未设密钥 → 503 拒跑」,本端点漏了同款兜底;
  // 而删除比发布更不可逆。护栏的默认必须是拒绝,不能是「没配置就等于不设防」。
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: '未配置 CRON_SECRET,拒绝在生产无保护执行媒体清理' }, { status: 503 },
      );
    }
    console.warn('[cron/cleanup-media] 未设 CRON_SECRET,非生产环境放行(生产会 503)');
  } else {
    // v12.236(第三轮对抗复检):密钥原本**只能**从 `?secret=` 读 —— 完整 URL 会被
    // Nginx/Vercel/CDN 的访问日志原样记下,等于把可触发**不可逆批量删除**的密钥明文写进日志;
    // 而兄弟端点 run-scheduled-publishes 早就用 Authorization 头。现在优先收头;
    // query 形式暂时保留(用户本机 launchd 定时任务在用),但每次命中都告警,提示改用头。
    const auth = request.headers.get('authorization') || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const queryed = url.searchParams.get('secret') || '';
    if (bearer !== secret && queryed !== secret) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!bearer && queryed === secret) {
      console.warn(
        '[cron/cleanup-media] ⚠️ 密钥走 ?secret= 查询参数,会明文进访问日志。' +
        '请改用 `Authorization: Bearer $CRON_SECRET`(该形式已支持)。',
      );
    }
  }
  const dryRun = url.searchParams.get('dryRun') === '1';
  const root = process.cwd();
  const report = {
    dryRun,
    composed: sweepDir(path.join(root, 'data', 'composed'), 7, dryRun),
    exports: sweepDir(path.join(root, 'data', 'exports'), 7, dryRun),
    media: sweepDir(path.join(root, 'data', 'media'), 14, dryRun),
    storage: dryRun ? { removed: 0 } : cleanup({ maxAgeDays: 30 }),
  };
  const totalRemoved = report.composed.removed + report.exports.removed + report.media.removed + (report.storage.removed || 0);
  return NextResponse.json({ ...report, totalRemoved, ranAt: new Date().toISOString() });
}

export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }
