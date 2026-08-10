/**
 * v12.239 — 第五轮对抗复检的修复回归锁。
 *
 * 这一轮的存活发现里,**有四条直接打在我 v12.238 刚写的代码上**(凭据错投 / 成本不记账 /
 * 无 opt-out / 参考图无超时),另有三类 IPv4-in-IPv6 变体是 v12.236-237 那两轮补漏时又漏的,
 * 外加一条五轮都没扫到的面(WebSocket 服务零鉴权 + 监听 0.0.0.0)。
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { isBlockedIp, embeddedIpv4 } from '@/lib/ssrf-guard';
import { hasGptImage } from '@/lib/image-providers/openai-gpt-image';
import { hasGeminiImage } from '@/lib/image-providers/gemini-image';

const ROOT = path.join(__dirname, '..');

describe('v12.239 SSRF · 补齐三类 IPv4-in-IPv6 隧道变体', () => {
  it('NAT64 local-use 前缀 64:ff9b:1::/48(RFC 8215)—— v12.236 的 g[2]===0 卡死漏掉', () => {
    expect(embeddedIpv4('64:ff9b:1::a9fe:a9fe')).toBe('169.254.169.254');
    expect(isBlockedIp('64:ff9b:1::a9fe:a9fe')).toBe(true);
  });

  it('Teredo 2001:0::/32 整段被拦(v12.242 起改为直接拒,不再取反抠 IPv4)', () => {
    // v12.239 曾让 embeddedIpv4 取反出客户端 IPv4 再判定;v12.242 发现那会把公网 IPv4 取反后
    // 误判成「组播」(理由错、结论碰巧对),改为整个 2001:0::/32 直接拒。isBlockedIp 结果不变。
    expect(isBlockedIp('2001:0:4136:e37e:8000:63bf:5601:5601')).toBe(true);
    expect(isBlockedIp('2001::1')).toBe(true);
  });

  it('ISATAP ::0:5efe:v4 / ::200:5efe:v4(RFC 5214)—— 非 fe80 前缀此前完全放行', () => {
    expect(isBlockedIp('2001:db8::5efe:a9fe:a9fe')).toBe(true);
    expect(isBlockedIp('2001:db8::200:5efe:a9fe:a9fe')).toBe(true);
  });

  it('公网地址不被这些新分支误杀', () => {
    for (const ip of ['2001:4860:4860::8888', '64:ff9b::8.8.8.8', '2606:4700:4700::1111']) {
      expect(isBlockedIp(ip), `${ip} 不该误杀`).toBe(false);
    }
  });
});

describe('v12.239 凭据必须与其配套 host 一起用(我 v12.238 的错投)', () => {
  it('只配 CREATIVE_API_KEY(第二 LLM 的 key)不再激活 gpt-image', () => {
    // 病根:激活条件回落到 CREATIVE_API_KEY,而 base 只认 OPENAI_BASE_URL ——
    // DeepSeek 的 key 会被当 Bearer 发到 api.openai.com。
    expect(hasGptImage({ OPENAI_IMAGE_ENABLED: '1', CREATIVE_API_KEY: 'sk-deepseek' } as never)).toBe(false);
  });
  it('配了 OPENAI_API_KEY 才激活', () => {
    expect(hasGptImage({ OPENAI_IMAGE_ENABLED: '1', OPENAI_API_KEY: 'sk-oa' } as never)).toBe(true);
  });
  it('源码里不得再出现 key 回落 CREATIVE_API_KEY(只看代码,不看注释)', () => {
    // 注意:第一版这条断言直接扫全文,结果被**我自己解释病根的注释**里引用的同一串字符命中,
    // 报了假阳性 —— v12.234 也踩过一次(注释里的 'view' 触发了鉴权级别的源码锁)。
    // 源码锁必须先剥注释,否则「解释清楚问题」这件事本身会把锁弄红。
    const raw = fs.readFileSync(path.join(ROOT, 'lib', 'image-providers', 'openai-gpt-image.ts'), 'utf-8');
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(/OPENAI_API_KEY\s*\|\|\s*env\.CREATIVE_API_KEY/.test(code)).toBe(false);
    expect(/const key = env\.OPENAI_API_KEY \|\| ''/.test(code)).toBe(true);
  });
});

describe('v12.239 Gemini 可被显式关掉(与 gpt-image 对称)', () => {
  it('GEMINI_IMAGE_ENABLED=0 → 不接管图像链', () => {
    expect(hasGeminiImage({ GEMINI_API_KEY: 'g', GEMINI_IMAGE_ENABLED: '0' } as never)).toBe(false);
  });
  it('仅有 key → 启用(issue #11 用户的默认预期)', () => {
    expect(hasGeminiImage({ GEMINI_API_KEY: 'g' } as never)).toBe(true);
  });
});

describe('v12.239 成本记账覆盖 data: URI(两个新 provider 都返 data:)', () => {
  it('记账条件包含 data: 前缀 —— 否则新付费路径对预算护栏完全隐形', () => {
    // 同上:剥注释后直接断言那一行判断条件本身。
    const raw = fs.readFileSync(path.join(ROOT, 'services', 'hybrid-orchestrator.ts'), 'utf-8');
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(
      /if \(url && \/\^\(https\?:\|data:\|/.test(code),
      '记账条件必须匹配 data: URI(两个新 provider 都返 data:)',
    ).toBe(true);
  });
});

describe('v12.239 参考图外链拉取必须有超时', () => {
  it('toInlineDataPart 的 safeFetch 带 signal(慢速流不能无限占用连接)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'image-providers', 'gemini-image.ts'), 'utf-8');
    expect(/safeFetch\(url, \{\s*\}\)/.test(src), '不得再传空 init').toBe(false);
    expect(/AbortSignal\.timeout\(/.test(src)).toBe(true);
  });
});

describe('v12.239 WebSocket 服务不再零鉴权 / 不再默认 0.0.0.0', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'ws-server.mjs'), 'utf-8');

  it('默认绑回环,而不是隐式监听 0.0.0.0', () => {
    expect(/const HOST = process\.env\.WS_HOST \|\| '127\.0\.0\.1'/.test(src)).toBe(true);
    expect(/new WebSocketServer\(\{ port: PORT, host: HOST \}\)/.test(src)).toBe(true);
  });

  it('连接要校验共享 token,且用 timingSafeEqual', () => {
    expect(src.includes('timingSafeEqual')).toBe(true);
    expect(/searchParams\.get\('token'\)/.test(src) || src.includes("get('token')")).toBe(true);
  });

  it('绑非回环却没配 secret → 拒绝启动(不给「以为安全」的裸奔机会)', () => {
    expect(/!IS_LOOPBACK && !WS_TOKEN/.test(src)).toBe(true);
    expect(src.includes('process.exit(1)')).toBe(true);
  });
});

describe('v12.239 SSE 客户端断开要能取消(别再空烧付费额度)', () => {
  it('createSSEResponse 把 signal 交给 handler,并在 stream cancel 时 abort', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'sse.ts'), 'utf-8');
    expect(/handler: \(send: SSESend, signal: AbortSignal\)/.test(src)).toBe(true);
    expect(/cancel\(\) \{ ac\.abort\(\); \}/.test(src)).toBe(true);
  });

  it('u2v/stream 用上了 signal 并传入 request.signal', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app', 'api', 'u2v', 'stream', 'route.ts'), 'utf-8');
    expect(/async \(send, signal\)/.test(src)).toBe(true);
    expect(/upstreamSignal: request\.signal/.test(src)).toBe(true);
    expect(/signal\.aborted/.test(src)).toBe(true);
  });
});

describe('v12.239 CI 权限收敛', () => {
  it('workflow 显式声明最小 GITHUB_TOKEN 权限', () => {
    const src = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf-8');
    expect(/^permissions:/m.test(src)).toBe(true);
    expect(/contents: read/.test(src)).toBe(true);
  });
});
