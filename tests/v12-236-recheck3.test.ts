/**
 * v12.236 — 第三轮独立对抗复检的修复回归锁。
 *
 * 这一轮最刺眼的一条,又打在我自己上一版刚写的代码上:v12.234 新建的 SSRF 守卫 `isBlockedIp`,
 * 只用正则匹配**点分十进制**写法的 IPv4 映射地址(`::ffff:127.0.0.1`),而 RFC 4291 允许同一地址
 * 写成纯十六进制分组 `::ffff:7f00:1` —— 正则不匹配就放行,Linux 双栈套接字照样连到 127.0.0.1。
 * 连云 IMDS 的 `::ffff:a9fe:a9fe` 都放行了。而我 v12.234 写的测试**只覆盖了点分那一种写法** ——
 * 测试照着实现的偏见写,就只会确认那个偏见。这一版改成「先展开成 8 组再判定」,不依赖书写形式。
 *
 * 另一条方法论落成测试:上一版的「哨兵写路径」不变量只扫改过的几个文件,又漏了 global-assets。
 * 这里的不变量一律 walk 全仓、扫**所有** handler。
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { isBlockedIp, embeddedIpv4, expandIpv6, assertOutboundUrlSafe } from '@/lib/ssrf-guard';
import { serveFilePathUrl, verifyServeFileSig } from '@/lib/serve-file-sign';
import { getSubtitleStyle, fontForLanguage } from '@/lib/subtitle-burn';

const ROOT = path.join(__dirname, '..');

function walkRoutes(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkRoutes(p, acc);
    else if (e.name === 'route.ts') acc.push(p);
  }
  return acc;
}
function handlerBody(src: string, method: string): string | null {
  const i = src.indexOf(`export async function ${method}(`);
  return i === -1 ? null : src.slice(i);
}
const ROUTES = walkRoutes(path.join(ROOT, 'app', 'api'));

describe('v12.236 SSRF · IPv4 映射 IPv6 不分书写形式一律拦截(CRITICAL 回归)', () => {
  it('十六进制分组写法的内网/元数据地址被拦(v12.234 正则漏的那批)', () => {
    const cases: Array<[string, string]> = [
      ['::ffff:7f00:1', '127.0.0.1'],
      ['::ffff:a00:1', '10.0.0.1'],
      ['::ffff:c0a8:101', '192.168.1.1'],
      ['::ffff:a9fe:a9fe', '169.254.169.254(云 IMDS)'],
      ['0:0:0:0:0:ffff:7f00:1', '127.0.0.1 全写'],
    ];
    for (const [ip, desc] of cases) {
      expect(embeddedIpv4(ip), `${ip} 应解出 ${desc}`).toBeTruthy();
      expect(isBlockedIp(ip), `${ip}(${desc})必须被拦`).toBe(true);
    }
  });

  it('点分写法仍拦(别把老用例改回归)', () => {
    expect(isBlockedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedIp('::ffff:169.254.169.254')).toBe(true);
  });

  it('废弃的 IPv4 兼容与 NAT64 前缀也覆盖', () => {
    expect(isBlockedIp('::7f00:1')).toBe(true);      // ::127.0.0.1 兼容(废弃)
    expect(isBlockedIp('64:ff9b::7f00:1')).toBe(true); // NAT64 → 127.0.0.1
  });

  it('公网 IPv6 / 公网映射地址不误杀', () => {
    for (const ip of ['2001:4860:4860::8888', '2606:4700:4700::1111', '::ffff:8.8.8.8', '::ffff:808:808']) {
      expect(isBlockedIp(ip), `${ip} 不该被误杀`).toBe(false);
    }
  });

  it('expandIpv6 对非法输入返回 null(不静默当 0 处理)', () => {
    expect(expandIpv6('not-an-ip')).toBeNull();
    expect(expandIpv6('::ffff:999.0.0.1')).toBeNull();
  });

  it('端到端:代理指向十六进制写法的 IMDS → 拒', async () => {
    const v = await assertOutboundUrlSafe('http://[::ffff:a9fe:a9fe]/latest/meta-data/');
    expect(v.ok).toBe(false);
  });
});

describe('v12.236 serve-file 签名能力 URL(跨用户 IDOR)', () => {
  const P = '/abs/data/composed/final-1730000000000.mp4';

  it('serveFilePathUrl 产出带 sig 的 URL,且能被自身验签', () => {
    const url = serveFilePathUrl(P);
    const u = new URL(url, 'http://localhost');
    expect(u.searchParams.get('sig')).toBeTruthy();
    expect(verifyServeFileSig(decodeURIComponent(u.searchParams.get('path')!), u.searchParams.get('sig'))).toBe(true);
  });

  it('无签名 / 伪造签名 / 改路径复用旧签名 → 一律拒', () => {
    expect(verifyServeFileSig(P, null)).toBe(false);
    expect(verifyServeFileSig(P, 'deadbeef'.repeat(4))).toBe(false);
    const sig = new URL(serveFilePathUrl(P), 'http://x').searchParams.get('sig');
    expect(verifyServeFileSig(P.replace('final', 'victim'), sig)).toBe(false);
  });

  it('解析方用 searchParams 取 path 时,多出来的 &sig 不污染路径', () => {
    const u = new URL(serveFilePathUrl(P), 'http://localhost');
    expect(decodeURIComponent(u.searchParams.get('path')!)).toBe(P);
  });

  it('serve-file 路由的 path= 分支确实调了 verifyServeFileSig', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app', 'api', 'serve-file', 'route.ts'), 'utf-8');
    expect(src.includes('verifyServeFileSig(')).toBe(true);
  });

  it('全仓不得再有手拼未签名的 ?path= 生成点(必须走 serveFilePathUrl)', () => {
    const offenders: string[] = [];
    const gen = /\/api\/serve-file\?path=\$\{encodeURIComponent\(/;
    for (const root of ['app', 'lib', 'services']) {
      const walk = (d: string) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) { walk(p); continue; }
          if (!/\.tsx?$/.test(e.name)) continue;
          if (e.name === 'serve-file-sign.ts') continue; // 签名函数本体是唯一合法的手拼点
          if (gen.test(fs.readFileSync(p, 'utf-8'))) offenders.push(path.relative(ROOT, p));
        }
      };
      walk(path.join(ROOT, root));
    }
    expect(offenders, `这些文件仍手拼未签名 ?path=:${offenders.join(', ')}`).toEqual([]);
  });
});

describe('v12.236 全仓不变量(升级 v12.234 版:扫所有 handler,不只清单)', () => {
  it('任何 handler 都不得「赋 __no_auth__ 后无守卫地继续执行写操作」', () => {
    const WRITE = ['POST', 'PUT', 'PATCH', 'DELETE'];
    const offenders: string[] = [];
    for (const f of ROUTES) {
      const src = fs.readFileSync(f, 'utf-8');
      for (const m of WRITE) {
        const body = handlerBody(src, m);
        if (!body) continue;
        // 截到下一个 handler 边界,避免把别的 handler 的守卫算进来
        const next = WRITE.concat('GET').map((x) => body.indexOf(`export async function ${x}(`, 1)).filter((i) => i > 0);
        const scoped = next.length ? body.slice(0, Math.min(...next)) : body;
        const hasSentinel = /= '__no_auth__'/.test(scoped);
        const hasGuard = /requireUser\(|requireProjectAccess\(|guardPaidEndpoint\(/.test(scoped);
        if (hasSentinel && !hasGuard) offenders.push(`${path.relative(ROOT, f)}#${m}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('cron 删除端点支持 Authorization 头(密钥不必进 URL 日志)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app', 'api', 'cron', 'cleanup-media', 'route.ts'), 'utf-8');
    expect(/headers\.get\('authorization'\)/.test(src)).toBe(true);
  });
});

describe('v12.236 字体合规 · ko/ja 语种覆盖不再指名 Apple 专有字体', () => {
  it('fontForLanguage 对 ko/ja 一律返回开源名(不分平台)', () => {
    for (const p of ['darwin', 'linux']) {
      expect(fontForLanguage('ko', 'X', {}, p)).toBe('Noto Sans KR');
      expect(fontForLanguage('ja', 'X', {}, p)).toBe('Noto Sans JP');
    }
  });

  it('getSubtitleStyle 配 ko/ja 语言时 FontName 不含专有字体', () => {
    for (const lang of ['ko', 'ja']) {
      expect(getSubtitleStyle('douyin', lang).fontName).not.toMatch(/Apple|Hiragino|PingFang|STHeiti/i);
    }
  });

  it('SUBTITLE_FONT env 仍最优先(别把显式覆盖也改没了)', () => {
    expect(fontForLanguage('ko', 'X', { SUBTITLE_FONT: 'MyFont' })).toBe('MyFont');
  });
});

describe('v12.236 DEMO_ADMIN 生产强制失效', () => {
  it('lib/db.ts 里 DEMO_ADMIN 受 NODE_ENV 门控', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'db.ts'), 'utf-8');
    // 不能再是「只看 DEMO_ADMIN==='1'」的裸判定
    expect(/const demoRole = process\.env\.DEMO_ADMIN === '1' \? 'admin' : 'member'/.test(src)).toBe(false);
    expect(src.includes("NODE_ENV === 'production'")).toBe(true);
  });
});
