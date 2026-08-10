/**
 * 「消费方门禁」基线机制 —— v12.240。
 *
 * ## 为什么需要基线
 *
 * 门禁第一次跑出 **42 处** 命中。如果要求「全修完才能上线」,这套东西就永远上不了线;
 * 如果一次性全塞白名单,白名单立刻腐化成一张「随便加就能过」的清单 —— 两条路都是死的。
 *
 * 所以采用大型代码库引入静态检查的标准做法:**基线快照**。
 *   · 存量违规记入 baseline,视为**已登记的技术债**,不阻断 CI;
 *   · **新增**违规一律阻断 —— 这正是「新代码必须验消费方」的落点;
 *   · baseline **只能减不能增**:清理一条就删一条,想加新条目必须显式 `--update` 并在 review 里被看见。
 *
 * ## 指纹为什么不含行号
 *
 * 第一版想用 `file:line` 做 key,但那样任何无关改动(上面插一行注释)都会让指纹漂移,
 * 于是「一条老债」变成「一条新违规」,CI 无故变红。人被无故的红弄烦之后,
 * 下一步就是关掉门禁 —— 假红对门禁的杀伤力不亚于假绿。
 * 所以指纹用 `contractId | file | 归一化后的代码片段`,对行号漂移免疫。
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Violation } from './scan';

export const BASELINE_PATH = 'lib/consumer-gate/baseline.json';

export interface BaselineFile {
  /** 写明这份基线是什么、怎么减少 —— 让第一次看到它的人不会误以为「这些是被批准的写法」。 */
  _readme: string[];
  /** 指纹 → 一句话说明(便于 review 时看懂这条债是什么)。 */
  entries: Record<string, string>;
}

/** 归一化代码片段:压空白 + 去尾逗号分号,避免格式化造成指纹漂移。 */
export function normalizeSnippet(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/[;,]\s*$/, '').trim();
}

export function fingerprint(v: Violation): string {
  const raw = `${v.contractId}|${v.file}|${normalizeSnippet(v.snippet)}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

export function loadBaseline(root: string): BaselineFile {
  const p = path.join(root, BASELINE_PATH);
  if (!fs.existsSync(p)) return { _readme: [], entries: {} };
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf-8')) as BaselineFile;
    return { _readme: j._readme || [], entries: j.entries || {} };
  } catch {
    return { _readme: [], entries: {} };
  }
}

export function writeBaseline(root: string, violations: Violation[]): void {
  const entries: Record<string, string> = {};
  for (const v of violations) {
    entries[fingerprint(v)] = `${v.contractId} @ ${v.file} — ${normalizeSnippet(v.snippet).slice(0, 100)}`;
  }
  const body: BaselineFile = {
    _readme: [
      '这是「消费方门禁」的存量债清单,不是被批准的写法白名单。',
      '门禁只阻断**不在此表**里的新违规;表里的条目是待清理的历史债。',
      '规则:只能减,不能增。清理掉一处就把对应条目删掉;',
      '真需要新增(例如确认某写法确实合法),应优先考虑加进 contracts.ts 的 allow 并写明理由,',
      '而不是往这里塞 —— allow 需要理由,baseline 不需要,所以 baseline 更容易腐化。',
      `生成方式:npm run gate:consumer -- --update`,
    ],
    entries: Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))),
  };
  fs.writeFileSync(path.join(root, BASELINE_PATH), JSON.stringify(body, null, 2) + '\n', 'utf-8');
}

export interface GateResult {
  /** 新增违规 —— 这些会让门禁失败。 */
  fresh: Violation[];
  /** 命中基线的存量债。 */
  known: Violation[];
  /** 基线里已不存在的条目(说明债还清了,应该把它从基线删掉)。 */
  stale: string[];
}

export function partition(root: string, violations: Violation[]): GateResult {
  const base = loadBaseline(root);
  const seen = new Set<string>();
  const fresh: Violation[] = [];
  const known: Violation[] = [];
  for (const v of violations) {
    const fp = fingerprint(v);
    seen.add(fp);
    if (base.entries[fp]) known.push(v);
    else fresh.push(v);
  }
  const stale = Object.keys(base.entries).filter((fp) => !seen.has(fp));
  return { fresh, known, stale };
}
