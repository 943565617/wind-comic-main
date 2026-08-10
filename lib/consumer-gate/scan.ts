/**
 * 「消费方门禁」扫描器 —— v12.240。
 *
 * 契约见 `./contracts.ts`。这里只负责:遍历 → 剥注释 → 匹配 → 出报告。
 *
 * **为什么必须剥注释**:v12.234 和 v12.239 各踩过一次 —— 我在注释里解释病根时引用了
 * 违规写法本身(例如「此处原为 `OPENAI_API_KEY || CREATIVE_API_KEY`」),源码锁直接扫全文
 * 就把自己的解释判成了违规。**把问题讲清楚不该让门禁报警**,所以剥注释是硬要求,
 * 不是优化。同理也剥字符串字面量里的 URL 片段(文档/错误提示里常出现)。
 */
import fs from 'fs';
import path from 'path';
import { CONTRACTS, DANGEROUS_ENV_SWITCHES, type GateContract } from './contracts';

export interface Violation {
  contractId: string;
  file: string;
  line: number;
  snippet: string;
  rule: string;
  entry: string;
  incident: string;
}

/**
 * 剥掉块注释、行注释。**保留**字符串字面量(有些契约就是要查字面量,如硬编码字体路径),
 * 但把它们的换行结构保住,以便行号仍然准确。
 */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  let mode: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl' = 'code';
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && c2 === '/') { mode = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && c2 === '*') { mode = 'block'; out += '  '; i += 2; continue; }
      if (c === "'") { mode = 'sq'; }
      else if (c === '"') { mode = 'dq'; }
      else if (c === '`') { mode = 'tpl'; }
      out += c; i++; continue;
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += '\n'; }
      else out += ' ';
      i++; continue;
    }
    if (mode === 'block') {
      if (c === '*' && c2 === '/') { mode = 'code'; out += '  '; i += 2; continue; }
      out += c === '\n' ? '\n' : ' ';
      i++; continue;
    }
    // 字符串内:原样保留,处理转义与结束符
    if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
    if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) {
      mode = 'code';
    }
    out += c; i++; continue;
  }
  return out;
}

function walk(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/**
 * 白名单匹配:精确路径 / 目录前缀(以 `/` 结尾)/ 简单 glob(`*` 匹配单层内任意字符)。
 * v12.242:拦所有 fetch 后白名单条目变多,同类(如 9 个 service 的 fetchWithTimeout 包装)
 * 用一条 glob 覆盖,避免清单臃肿到没人看。
 */
function isAllowed(c: GateContract, rel: string): boolean {
  return c.allow.some((a) => {
    if (a.file === rel) return true;
    if (a.file.endsWith('/')) return rel.startsWith(a.file);
    if (a.file.includes('*')) {
      const re = new RegExp('^' + a.file.split('*').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
      return re.test(rel);
    }
    return false;
  });
}

/** 生成「这一行是否落在指定 handler 体内」的判定函数;未指定 handlerScope 则全放行。 */
function handlerLineFilter(code: string, methods?: string[]): (line: number) => boolean {
  if (!methods || !methods.length) return () => true;
  const lines = code.split('\n');
  const ALL = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  const marks: Array<{ line: number; method: string }> = [];
  lines.forEach((l, i) => {
    const m = l.match(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/);
    if (m && ALL.includes(m[1])) marks.push({ line: i + 1, method: m[1] });
  });
  if (!marks.length) return () => false; // 文件里没有 handler → 该契约不适用
  const ranges: Array<[number, number]> = [];
  marks.forEach((mk, idx) => {
    if (!methods.includes(mk.method)) return;
    ranges.push([mk.line, idx + 1 < marks.length ? marks[idx + 1].line - 1 : lines.length]);
  });
  return (line: number) => ranges.some(([a, b]) => line >= a && line <= b);
}

/** 跑一条契约。 */
function scanContract(root: string, c: GateContract): Violation[] {
  if (!c.scope.length) return [];
  const out: Violation[] = [];
  for (const scope of c.scope) {
    for (const abs of walk(path.join(root, scope))) {
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (isAllowed(c, rel)) continue;
      if (/\.(test|spec)\.tsx?$/.test(rel)) continue; // 测试夹具允许写反例
      // 门禁自身要排除:契约表里必然引用「违规写法」本身来描述规则,
      // 不排除的话这套东西第一次跑就会把自己判成违规(第一版实测中招 2 处)。
      if (rel.startsWith('lib/consumer-gate/')) continue;
      const code = stripComments(fs.readFileSync(abs, 'utf-8'));
      const lines = code.split('\n');
      // handlerScope:只在指定 HTTP 方法的 handler 体内匹配。用行号区间近似切片 ——
      // 从 `export async function POST(` 起,到下一个 export handler 或文件末为止。
      const inScope = handlerLineFilter(code, c.handlerScope);
      for (let i = 0; i < lines.length; i++) {
        if (!inScope(i + 1)) continue;
        const re = new RegExp(c.forbid.source, c.forbid.flags.replace('g', ''));
        if (re.test(lines[i])) {
          out.push({
            contractId: c.id, file: rel, line: i + 1,
            snippet: lines[i].trim().slice(0, 120),
            rule: c.rule, entry: c.entry, incident: c.incident,
          });
        }
      }
    }
  }
  return out;
}

/**
 * 危险 env 开关:检查其所在文件里确实有 production 门控。
 * 比正则拦截准 —— 写法千变万化,但「这个文件必须提到 production」是稳定信号。
 */
export function auditEnvSwitches(root: string): Violation[] {
  const out: Violation[] = [];
  for (const sw of DANGEROUS_ENV_SWITCHES) {
    const abs = path.join(root, sw.file);
    if (!fs.existsSync(abs)) continue;
    const code = stripComments(fs.readFileSync(abs, 'utf-8'));
    if (!code.includes(sw.name)) continue; // 开关已删除
    // 门控写法两种都算数:`=== 'production'` 强制失效,或 `!== 'production'` 才允许。
    // 第一版只匹配 === ,把 ssrf-guard 里 `NODE_ENV !== 'production'` 的正确写法误判成违规。
    if (!/NODE_ENV\s*[!=]==?\s*['"]production['"]/.test(code)) {
      out.push({
        contractId: 'dangerous-env-switch-must-die-in-prod',
        file: sw.file, line: 0,
        snippet: `${sw.name} 无 production 门控`,
        rule: '能削弱安全的 env 开关必须在生产强制失效',
        entry: "if (... && NODE_ENV === 'production') 忽略并告警",
        incident: sw.why,
      });
    }
  }
  return out;
}

/** 白名单自检:每条例外都必须写明理由 —— 没理由的白名单本身是违规。 */
export function auditAllowlistReasons(): Violation[] {
  const out: Violation[] = [];
  for (const c of CONTRACTS) {
    for (const a of c.allow) {
      if (!a.why || a.why.trim().length < 8) {
        out.push({
          contractId: c.id, file: a.file, line: 0,
          snippet: `白名单条目缺少理由`,
          rule: '白名单每条都必须写清 why(加白名单 = 显式声明「我知道我在绕过」)',
          entry: 'contracts.ts 的 allow[].why',
          incident: '无理由的白名单会让门禁在几次「先加上让 CI 过」之后彻底失效',
        });
      }
    }
  }
  return out;
}

export function runConsumerGate(root: string): Violation[] {
  return [
    ...CONTRACTS.flatMap((c) => scanContract(root, c)),
    ...auditEnvSwitches(root),
    ...auditAllowlistReasons(),
  ];
}
