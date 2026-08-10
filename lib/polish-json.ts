/**
 * 润色结果 JSON 解析 —— 三级降级工具。
 *
 * 抽离自 app/api/polish-script/route.ts, 独立成 lib 模块原因:
 *   1. 纯函数逻辑, 易测 (对应 tests/polish-parser.test.ts)
 *   2. 未来 Editor 评分 / Writer 输出等其他环节若遇到同类"LLM JSON 结构损坏"场景可以直接复用
 *
 * 为什么需要这个:
 *   第三方聚合网关(qingyuntop 等)对 response_format: json_object 执行不严,
 *   Claude / GPT 在包含中文长文本的字段里经常塞进真实换行符 (0x0A),
 *   直接 JSON.parse 会抛。按以下顺序兜底:
 *     Tier 1: strict JSON.parse
 *     Tier 2: 去 markdown 围栏 + 取最外层 {...}, 再 strict
 *     Tier 3: 修复字符串内裸换行/制表符, 再 strict
 *     Tier 4: 正则硬抽 polished / summary / notes
 */

/**
 * 多级降级 JSON 解析。
 * 返回值里存在 polished(string)视为成功;全失败返回 null。
 */
export function robustJsonParse(raw: string): any | null {
  // ── Tier 1: 原样解析
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === 'object') return v;
  } catch {}

  // ── Tier 2: 去掉 markdown 围栏 + 取最外层 {...}
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  const candidate = m ? m[0] : cleaned;
  try {
    const v = JSON.parse(candidate);
    if (v && typeof v === 'object') return v;
  } catch {}

  // ── v2.13.2 Tier 2.5: 把全角"中文引号"先还原成 ASCII (LLM 经常混着用)
  // 注意只替换"出现在 ASCII " 之间"的全角引号 — 别把内嵌正文里真实的"说"字号给误改
  const dequoted = candidate
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
  try {
    const v = JSON.parse(dequoted);
    if (v && typeof v === 'object') return v;
  } catch {}

  // ── Tier 3: 修复字符串内部的裸控制字符 (\n \r \t) — 在 dequoted 基础上做
  try {
    const repaired = repairJsonStrings(dequoted);
    const v = JSON.parse(repaired);
    if (v && typeof v === 'object') return v;
  } catch {}

  // ── v2.13.2 Tier 3.5: 兜底用平衡-括号扫描更稳的截取
  const fixed = repairJsonStrings(dequoted);
  try {
    // 从第一个 { 开始扫直到平衡, 截到第一个完整对象
    const sliced = sliceFirstBalancedObject(fixed);
    if (sliced) {
      const v = JSON.parse(sliced);
      if (v && typeof v === 'object') return v;
    }
  } catch {}

  // ── v12.148 Tier 3.7: 内容裸引号转义 —— Tier 2.5 的全角→ASCII 引号替换会把
  // 中文正文里的“成对引号”变成裸 ASCII 引号(提前终止字符串,整包炸)。启发式:
  // 字符串内遇 '"' 且后面第一个非空白字符不是 , } ] :(不像合法闭合)→ 视为内容引号转义。
  const quoteFixed = escapeUnescapedQuotes(fixed);
  try {
    const v = JSON.parse(quoteFixed);
    if (v && typeof v === 'object') return v;
  } catch {}

  // ── v12.148 Tier 3.8: 截断补全 —— LLM 输出超长被腰斩(如 Writer 23KB 剧本在字符串
  // 中间断掉)时,回退到最后一个结构安全点、按括号栈补闭合,救回完整前缀。
  // 此前这种情况 4 级全败 → 整包好剧本被扔掉换模板兜底(占位「镜头N」),损失极大。
  try {
    const completed = completeTruncatedJson(quoteFixed);
    if (completed) {
      const v = JSON.parse(completed);
      if (v && typeof v === 'object') return v;
    }
  } catch {}

  // ── Tier 4: 正则硬抽
  return extractFieldsByRegex(candidate);
}

/**
 * 字符串内容里的未转义 ASCII 引号 → \"(v12.148 Tier 3.7)。
 * 判定:inString 时遇 '"',窥探其后第一个非空白字符 —— 是 , } ] : 或 EOF 则视为
 * 合法闭合;否则视为正文引号,转义后保持 inString。对已转义的 \" 不动。
 */
export function escapeUnescapedQuotes(s: string): string {
  let out = '';
  let inString = false, escaped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escaped) { out += c; escaped = false; continue; }
    if (c === '\\' && inString) { out += c; escaped = true; continue; }
    if (c === '"') {
      if (!inString) { inString = true; out += c; continue; }
      let j = i + 1;
      while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n' || s[j] === '\r')) j++;
      const n = j < s.length ? s[j] : '';
      // 逗号还要再窥一位:内容引号后恰好跟逗号(『他说"你是谁",然后…』)会伪装成闭合 ——
      // 逗号之后若不是「新 key/新值的开始」("、数字、-、{、[、t/f/n)则仍是内容引号。
      let closes = n === '}' || n === ']' || n === ':' || n === '';
      if (n === ',') {
        let k = j + 1;
        while (k < s.length && (s[k] === ' ' || s[k] === '\t' || s[k] === '\n' || s[k] === '\r')) k++;
        const n2 = k < s.length ? s[k] : '';
        closes = n2 === '"' || n2 === '{' || n2 === '[' || n2 === '-' || (n2 >= '0' && n2 <= '9') || n2 === 't' || n2 === 'f' || n2 === 'n' || n2 === '';
      }
      if (closes) { inString = false; out += c; }
      else { out += '\\"'; } // 内容引号:转义,保持在字符串内
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * 截断 JSON 补全:收集所有「结构安全点」(字符串外的 ',' 与 '}' ']'),从最后一个
 * 往前逐个尝试 —— 截到该点、去尾部悬空逗号、按当时括号栈补闭合、strict parse。
 * 首个 parse 成功的返回;全败/本就完整(栈空)→ null。
 * 尝试点上限 24:安全点位于长文本 JSON 的密集尾部,24 个足够跨过残缺的最后一个对象。
 */
export function completeTruncatedJson(s: string, maxAttempts = 24): string | null {
  const start = s.indexOf('{');
  if (start === -1) return null;
  const candidates: Array<{ idx: number; stack: string[] }> = [];
  const stack: string[] = [];
  let inString = false, escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\' && inString) { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') { stack.pop(); candidates.push({ idx: i, stack: [...stack] }); }
    else if (c === ',') candidates.push({ idx: i - 1, stack: [...stack] }); // 截到逗号前一位
  }
  if (stack.length === 0 && !inString) return null; // 结构本就平衡,轮不到本级
  for (let k = candidates.length - 1, tried = 0; k >= 0 && tried < maxAttempts; k--, tried++) {
    const { idx, stack: st } = candidates[k];
    const head = s.slice(start, idx + 1).replace(/,\s*$/, '');
    const attempt = head + [...st].reverse().join('');
    try {
      const v = JSON.parse(attempt);
      if (v && typeof v === 'object') return attempt;
    } catch { /* 下一个候选点 */ }
  }
  return null;
}

/**
 * 从字符串中找到第一个完整平衡的 {...} 对象,返回该对象的子串。
 * 字符串内部的 { } 不计入栈, 用引号状态跟踪。
 */
export function sliceFirstBalancedObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\' && inString) { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * 扫一遍字符串, 跟踪是否在 JSON 字符串内部,
 * 遇到裸 \n \r \t 就替换成转义序列, 让 JSON.parse 能接受。
 */
export function repairJsonStrings(s: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escaped) {
      out += c;
      escaped = false;
      continue;
    }
    if (c === '\\' && inString) {
      out += c;
      escaped = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      out += c;
      continue;
    }
    if (inString) {
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') { out += '\\r'; continue; }
      if (c === '\t') { out += '\\t'; continue; }
    } else if (c === '+' && s[i + 1] >= '0' && s[i + 1] <= '9') {
      // v12.169:LLM 在数字数组里写正号(emotionTemperature 曲线 [-4, +3, +8])—— JSON 非法,
      // 且会毒死截断补全的所有回退候选。字符串外的 +数字 剥掉 +(合法 JSON 字符串外不会有 +)。
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * 最后一道防线: 结构彻底坏掉时, 正则抽 polished / summary / notes。
 *
 * v2.13.2 增强: 普通 regex 命中时如果 polished 长度过短(< 30 字符,
 * 八成是被中间某个未转义引号截断了), 改用"贪婪截到下一个根字段或对象末"的策略。
 */
export function extractFieldsByRegex(s: string): any | null {
  const result: any = {};

  // 1. 先尝试严格解析 polished 字段
  const pm = s.match(/"polished"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (pm) {
    try {
      result.polished = JSON.parse('"' + pm[1] + '"');
    } catch {
      result.polished = pm[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
  }

  // 2. 严格匹配命中但太短(疑似被未转义引号腰斩) → 用贪婪兜底
  // 寻找 "polished":" 起点, 一直读到下一个 ", "summary": / "notes": / "issues": / 对象末 } 之前
  if (!result.polished || result.polished.length < 30) {
    const startIdx = s.search(/"polished"\s*:\s*"/);
    if (startIdx >= 0) {
      const headMatch = s.slice(startIdx).match(/"polished"\s*:\s*"/);
      if (headMatch) {
        const valStart = startIdx + (headMatch.index ?? 0) + headMatch[0].length;
        // 找下一个根字段开头 (",\s*"summary" / "notes" / "issues" / "audit")
        const tailRegex = /",\s*"(?:summary|notes|issues|audit|polishedTitle|industry)"\s*:/;
        const tailMatch = s.slice(valStart).match(tailRegex);
        const valEnd = tailMatch && tailMatch.index !== undefined
          ? valStart + tailMatch.index
          : s.lastIndexOf('"', s.lastIndexOf('}'));
        if (valEnd > valStart) {
          const greedy = s.slice(valStart, valEnd);
          // 解码常见转义并尽力清理无终止引号导致的尾部杂质
          const decoded = greedy
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');
          if (decoded.length > (result.polished?.length || 0)) {
            result.polished = decoded;
            result._greedyFallback = true; // 给上层标记"是贪婪兜底,提示用户检查"
          }
        }
      }
    }
  }

  const sm = s.match(/"summary"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (sm) {
    try { result.summary = JSON.parse('"' + sm[1] + '"'); }
    catch { result.summary = sm[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'); }
  }
  const nm = s.match(/"notes"\s*:\s*(\[[\s\S]*?\])/);
  if (nm) {
    try {
      const arr = JSON.parse(nm[1]);
      if (Array.isArray(arr)) result.notes = arr;
    } catch {}
  }
  return result.polished ? result : null;
}

/**
 * 彻底解析失败时, 把 JSON 外壳剥掉, 尽量给用户一段能读的正文,
 * 而不是 {"polished":"..."} 的 raw 字符串。
 */
export function stripJsonWrapper(raw: string): string {
  const pm = raw.match(/"polished"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (pm) {
    try { return JSON.parse('"' + pm[1] + '"'); }
    catch { return pm[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\'); }
  }
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^\s*\{\s*/, '')
    .replace(/\s*\}\s*$/, '')
    .trim();
}
