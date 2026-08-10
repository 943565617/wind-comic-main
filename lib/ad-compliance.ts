/**
 * 广告合规检查(v12.65.0)——《广告法》绝对化用语 + 虚假承诺红线。
 *
 * 电商/广告成片里「最/第一/顶级/国家级/根治」等词是硬红线:平台(抖音/小红书/淘宝)审核会拒,
 * 市监还可罚款(《广告法》第九条)。AI 编剧极易顺嘴写出「最好用的精华水」。本模块:
 *   - checkAdCompliance(text) → 命中的违禁词 + 类别(检测,报告用)
 *   - sanitizeAdCopy(text)   → 自动替换成安全表达(台词/字幕/CTA 落地前过一遍)
 * 纯函数,零依赖,可单测。词表按「绝对化 / 极限承诺 / 医疗化妆品红线」分组,替换词保语感。
 */

export type ComplianceCategory = '绝对化用语' | '极限承诺' | '医疗功效红线' | '自定义' | (string & {});

export interface ComplianceHit {
  word: string;
  category: ComplianceCategory;
  replacement: string;
  index: number;
}

/** 违禁词 → 安全替换(顺序即优先级,长词在前防子串误替)。 */
interface CompiledRule { re: RegExp; word: string; category: ComplianceCategory; replacement: string }

const RULES: CompiledRule[] = [
  // ── 绝对化用语(广告法第九条)──
  { re: /最好用/g, word: '最好用', category: '绝对化用语', replacement: '很好用' },
  { re: /最强/g, word: '最强', category: '绝对化用语', replacement: '出色' },
  { re: /最佳/g, word: '最佳', category: '绝对化用语', replacement: '优选' },
  { re: /最先进/g, word: '最先进', category: '绝对化用语', replacement: '先进' },
  { re: /最优/g, word: '最优', category: '绝对化用语', replacement: '优质' },
  { re: /第一品牌/g, word: '第一品牌', category: '绝对化用语', replacement: '人气品牌' },
  { re: /全网第一/g, word: '全网第一', category: '绝对化用语', replacement: '全网热销' },
  { re: /销量第一/g, word: '销量第一', category: '绝对化用语', replacement: '销量领先' },
  { re: /行业第一/g, word: '行业第一', category: '绝对化用语', replacement: '行业领先' },
  { re: /世界级/g, word: '世界级', category: '绝对化用语', replacement: '高水准' },
  { re: /国家级/g, word: '国家级', category: '绝对化用语', replacement: '高规格' },
  { re: /顶级/g, word: '顶级', category: '绝对化用语', replacement: '高端' },
  { re: /极品/g, word: '极品', category: '绝对化用语', replacement: '精品' },
  { re: /独一无二/g, word: '独一无二', category: '绝对化用语', replacement: '独具特色' },
  { re: /空前绝后/g, word: '空前绝后', category: '绝对化用语', replacement: '难得一见' },
  // ── 极限承诺 ──
  { re: /百分之百|100%有效/g, word: '百分之百', category: '极限承诺', replacement: '高效' },
  { re: /永不(反弹|复发|褪色)/g, word: '永不…', category: '极限承诺', replacement: '持久' },
  { re: /立竿见影/g, word: '立竿见影', category: '极限承诺', replacement: '见效快' },
  { re: /(无效)?全额?退款保证/g, word: '退款保证', category: '极限承诺', replacement: '售后无忧' },
  // ── 医疗/化妆品功效红线(化妆品不得宣称医疗功效)──
  { re: /根治/g, word: '根治', category: '医疗功效红线', replacement: '改善' },
  { re: /治愈/g, word: '治愈', category: '医疗功效红线', replacement: '呵护' },
  { re: /治疗/g, word: '治疗', category: '医疗功效红线', replacement: '护理' },
  { re: /消炎/g, word: '消炎', category: '医疗功效红线', replacement: '舒缓' },
  { re: /杀菌/g, word: '杀菌', category: '医疗功效红线', replacement: '清洁' },
  { re: /抗癌|防癌/g, word: '抗癌', category: '医疗功效红线', replacement: '健康' },
  // ── v12.118 英文红线(FTC/平台审核常拒:虚假疗效/绝对承诺)──
  { re: /\bcures?\b/gi, word: 'cure', category: '英文红线', replacement: 'helps with' },
  { re: /\bmiracle\b/gi, word: 'miracle', category: '英文红线', replacement: 'remarkable' },
  { re: /\bguaranteed results?\b/gi, word: 'guaranteed results', category: '英文红线', replacement: 'real results' },
  { re: /\b100% (effective|safe)\b/gi, word: '100% effective/safe', category: '英文红线', replacement: 'highly effective' },
  { re: /(\bno\.?\s*1\b|#1)(?=\s|$)/gi, word: '#1', category: '英文红线', replacement: 'top-rated' },
  { re: /\brisk-free\b/gi, word: 'risk-free', category: '英文红线', replacement: 'easy to try' },
];

// ─── v12.112.0 词表可扩展 ───────────────────────────────────────────────────
// 内置表覆盖通用红线,但行业各有私货(保健品/金融/教培)。两条扩展通道:
//   1) env AD_COMPLIANCE_EXTRA="词=替换;词2=替换2"(快速)
//   2) data/compliance-extra.json: [{"word":"秒杀全场","replacement":"限时优惠","category":"自定义"}]
// 自定义词按字面匹配(regex 特殊字符自动转义),长词优先防子串误替。

export interface CustomRuleSpec { word: string; replacement: string; category?: string }

/** 纯函数:解析 env 速记 "词=替换;词2=替换2"。 */
export function parseExtraRuleSpec(spec: string | undefined): CustomRuleSpec[] {
  if (!spec) return [];
  return spec.split(/[;；]/).map((seg) => {
    const eq = seg.indexOf('=');
    if (eq <= 0) return null;
    const word = seg.slice(0, eq).trim();
    const replacement = seg.slice(eq + 1).trim();
    return word && replacement ? { word, replacement } : null;
  }).filter((x): x is CustomRuleSpec => !!x);
}

/** 纯函数:编译自定义词(转义 + 去重 + 长词在前)。 */
export function compileCustomRules(entries: CustomRuleSpec[]): CompiledRule[] {
  const seen = new Set<string>();
  const valid = (entries || []).filter((e) => e && typeof e.word === 'string' && e.word.trim() && typeof e.replacement === 'string' && e.replacement.trim() && !seen.has(e.word) && seen.add(e.word));
  valid.sort((a, b) => b.word.length - a.word.length);
  return valid.map((e) => ({
    re: new RegExp(e.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
    word: e.word,
    category: (e.category || '自定义') as ComplianceCategory,
    replacement: e.replacement,
  }));
}

let customCache: { at: number; key: string; rules: CompiledRule[] } | null = null;

function loadCustomRules(env: NodeJS.ProcessEnv): CompiledRule[] {
  const key = env.AD_COMPLIANCE_EXTRA || '';
  if (customCache && customCache.key === key && Date.now() - customCache.at < 30_000) return customCache.rules;
  const specs = [...parseExtraRuleSpec(key)];
  try {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const p = path.join(process.cwd(), 'data', 'compliance-extra.json');
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (Array.isArray(j)) specs.push(...j);
    }
  } catch (e) {
    console.warn('[Compliance] 扩展词表读取失败(忽略):', e instanceof Error ? e.message.slice(0, 60) : e);
  }
  const rules = compileCustomRules(specs);
  if (rules.length > 0 && (!customCache || customCache.key !== key)) console.log(`[Compliance] v12.112 扩展词表生效: ${rules.length} 条`);
  customCache = { at: Date.now(), key, rules };
  return rules;
}

function activeRules(env: NodeJS.ProcessEnv): CompiledRule[] {
  return [...RULES, ...loadCustomRules(env)];
}

/** 检测:返回全部命中(不修改文本)。 */
export function checkAdCompliance(text: string, env: NodeJS.ProcessEnv = process.env): ComplianceHit[] {
  const hits: ComplianceHit[] = [];
  if (!text) return hits;
  for (const r of activeRules(env)) {
    r.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = r.re.exec(text)) !== null) {
      hits.push({ word: m[0], category: r.category, replacement: r.replacement, index: m.index });
      if (m.index === r.re.lastIndex) r.re.lastIndex++;
    }
  }
  return hits;
}

/** 净化:违禁词替换为安全表达。返回 {text, hits}。 */
export function sanitizeAdCopy(text: string, env: NodeJS.ProcessEnv = process.env): { text: string; hits: ComplianceHit[] } {
  const hits = checkAdCompliance(text, env);
  if (hits.length === 0) return { text, hits };
  let out = text;
  for (const r of activeRules(env)) {
    r.re.lastIndex = 0;
    out = out.replace(r.re, r.replacement);
  }
  return { text: out, hits };
}

/** 对剧本 shots 的台词逐镜净化(就地修改),返回命中汇总。 */
export function sanitizeScriptDialogues(shots: Array<{ dialogue?: string }>): ComplianceHit[] {
  const all: ComplianceHit[] = [];
  for (const s of shots || []) {
    if (!s?.dialogue) continue;
    const { text, hits } = sanitizeAdCopy(s.dialogue);
    if (hits.length > 0) {
      s.dialogue = text;
      all.push(...hits);
    }
  }
  return all;
}
