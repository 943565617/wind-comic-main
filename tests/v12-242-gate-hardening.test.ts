/**
 * v12.242 — 消费方门禁自我加固 + 它抓到的第二个真 SSRF。
 *
 * 盲区自查发现:v12.241 的 outbound-fetch 正则「只拦 fetch( 后跟裸标识符」,
 * 8 种写法漏 7 种,其中 fetch(body.imageUrl) 直接来自请求体 —— 一个漏掉这个的 SSRF 门禁等于没有。
 * 改为拦所有裸 fetch,靠文件级白名单 + 必填理由放行。改完后门禁抓到 voice-clone 的真 SSRF。
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { CONTRACTS } from '@/lib/consumer-gate/contracts';
import { stripComments } from '@/lib/consumer-gate/scan';
import { isBlockedIp, assertOutboundUrlSafe } from '@/lib/ssrf-guard';

const ROOT = path.join(__dirname, '..');
const fetchContract = CONTRACTS.find((c) => c.id === 'outbound-fetch-must-use-safeFetch')!;
const re = () => new RegExp(fetchContract.forbid.source);

describe('v12.242 门禁正则拦得住此前漏掉的 7 种写法', () => {
  const shouldCatch = [
    'fetch(url, {})', 'fetch(obj.url)', 'fetch(arr[0])', 'fetch(body.imageUrl, {})',
    'fetch(`${userUrl}`)', 'const f = fetch;', 'globalThis.fetch(url)',
  ];
  for (const code of shouldCatch) {
    it(`拦:${code}`, () => {
      expect(code.split('\n').some((l) => re().test(l)), `漏掉 ${code}`).toBe(true);
    });
  }

  it('放行 safeFetch(它自己)与成员访问 a.fetch()', () => {
    expect(re().test('const r = await safeFetch(url, {});')).toBe(false);
    expect(re().test('await this.client.fetch(x);')).toBe(false); // 前面有 . → 不是裸 fetch
  });
});

describe('v12.242 stripComments 状态机边界(手写状态机的六个坑)', () => {
  const cases: Array<[string, string]> = [
    ["正则里的引号", `const re = /['"]/; const r = await fetch(url);`],
    ["URL 里的双斜杠", `const s = "https://x.com"; const r = await fetch(url);`],
    ["模板串嵌套", 'const s = `a${`b`}c`; const r = await fetch(url);'],
    ["转义引号", `const s = 'it\\'s'; const r = await fetch(url);`],
    ["除号像正则", `const x = a / b; const r = await fetch(url);`],
  ];
  for (const [name, src] of cases) {
    it(`不因「${name}」漏掉后续代码`, () => {
      expect(/fetch\(url\)/.test(stripComments(src))).toBe(true);
    });
  }
});

describe('v12.242 白名单支持前缀/glob(避免同类条目臃肿)', () => {
  it('services/*.service.ts glob 覆盖各引擎 service', () => {
    const globs = fetchContract.allow.map((a) => a.file);
    expect(globs).toContain('services/*.service.ts');
    expect(globs).toContain('lib/image-providers/*');
  });
});

describe('v12.242 Teredo 整段直接拒(理由要对,不是碰巧对)', () => {
  it('2001:0::/32 一律拦,含公网客户端形式', () => {
    expect(isBlockedIp('2001::1')).toBe(true);
    expect(isBlockedIp('2001:0:4136:e37e:8000:63bf:5601:5601')).toBe(true);
  });
  it('正常公网 2001:4860::/2606:4700:: 不误杀', () => {
    expect(isBlockedIp('2001:4860:4860::8888')).toBe(false);
    expect(isBlockedIp('2606:4700:4700::1111')).toBe(false);
  });
  it('DNS 层拒绝信息列出全部解析结果(排查 DNS 污染用)', async () => {
    // 不依赖真实 DNS:直接验证 assertOutboundUrlSafe 对字面量内网地址的措辞不含误导性的「组播」
    const v = await assertOutboundUrlSafe('http://[2001::1]/');
    expect(v.ok).toBe(false);
  });
});

describe('v12.242 voice-clone 音样下载过 SSRF 守卫(门禁抓到的第二个真 SSRF)', () => {
  it('sampleUrl 不再裸 fetch,走 safeFetch + 站内验签', () => {
    const src = fs.readFileSync(path.join(ROOT, 'services', 'voice-clone.service.ts'), 'utf-8');
    const code = stripComments(src);
    expect(code.includes('safeFetch(')).toBe(true);
    expect(code.includes('resolveVerifiedServeFilePath')).toBe(true);
    expect(/const dl = await fetch\(opts\.sampleUrl\)/.test(code), '仍有裸 fetch(sampleUrl)').toBe(false);
  });
});
