/**
 * lib/edit-intent — 对话式编辑:自然语言 → 结构化编辑意图(v12.248)。
 *
 * ## 为什么做,又为什么落在这一层
 *
 * 07-24 竞品刷新暴露的新范式:Gemini Omni Flash 的**对话式视频编辑**(自然语言迭代改片)。
 * Wind Comic 不在生成层硬拼,但这个**交互范式**可以落在自己的护城河——**编排层**:
 * 用户对成片说「删掉第 3 镜,改成竖屏卡点字幕,节奏快一点」,系统解析成一组**编辑意图**,
 * 再映射到早已存在的 `recompose` / `regenerate-shot` 端点。生成层是别人的,编排层是我们的。
 *
 * ## 只解析,不盲目执行
 *
 * 本模块是纯函数:文本 → 意图列表。**不执行**任何破坏性操作(删镜/重配音都要花钱或不可逆)——
 * 意图交给前端渲染成「我将:①… ②…」,用户确认后才调既有端点。这既安全,又复用全部现成能力。
 *
 * 规则层(关键词 + 镜号提取)确定性、可测;LLM 增强可作为后续叠加(失败降级到规则层)。
 */

export type EditOp =
  | { op: 'setCaptionStyle'; value: 'clean' | 'social' | 'bold' | 'karaoke' }
  | { op: 'setPlatform'; value: 'douyin' | 'xiaohongshu' | 'none' }
  | { op: 'setAspect'; value: '16:9' | '9:16' }
  | { op: 'setPace'; value: 'fast' | 'slow' }
  | { op: 'dropShot'; shotNumber: number }
  | { op: 'regenVoiceover' }
  | { op: 'regenShot'; shotNumber: number; note?: string };

export interface EditIntentResult {
  intents: EditOp[];
  /** 没解析出任何意图的原文(便于前端提示「没听懂,换个说法」)。 */
  unmatched: boolean;
}

/** 从文本里抽所有镜号:「第3镜」「第 3 个镜头」「shot 3」「镜头2」。 */
export function extractShotNumbers(text: string): number[] {
  const nums = new Set<number>();
  const patterns = [
    /第\s*(\d+)\s*(?:个)?\s*(?:镜头|镜|幕|shot)/gi,
    /(?:镜头|镜|shot)\s*(\d+)/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n > 0) nums.add(n);
    }
  }
  return [...nums].sort((a, b) => a - b);
}

// 注意:「卡点」不进 FAST_WORDS —— 它更常指「卡点字幕」(karaoke 词级扫光),归到字幕风格,避免和节奏抢判。
const FAST_WORDS = ['快节奏', '快一点', '快点', '燃', '爽', '热血', '紧凑', '动感', '高能', '爆款', '鬼畜', 'fast', 'faster', 'snappy'];
const SLOW_WORDS = ['慢一点', '慢点', '放慢', '舒缓', '抒情', '文艺', '治愈', '唯美', '沉静', '留白', '悠长', 'slow', 'slower'];

// 破坏性/镜级操作的动词表(删镜、重生镜、重配音)。这些操作花钱或不可逆,判定必须严谨:
// ① 动词与镜号要限定在**同一分句**(否则「删掉第1镜,第2镜调暗」会把全局 wantsDrop 套到第2镜);
// ② 要认**否定**(「不要删第3镜」绝不能发出删除意图 —— 宁可漏,不可反向删)。
const DROP_RE = /删掉|删除|去掉|删了|拿掉|移除|remove|delete|drop/;
const REGEN_RE = /重画|重生|重新生成|改一下|改得|调暗|调亮|更暗|更亮|重拍|redo|regen|regenerate/;
const REVOICE_RE = /重新配音|重配音|换配音|再配一次|重录|revoice|re-?voice/;
// 否定词(出现在动词**之前**才算否定该动词,避免「改暗一点别太暗」里的「别」误伤)。
const NEG_RE = /不要|不用|不想|不准|不删|不去|别|勿|请勿|甭|无需|don'?t|do ?not|no need/i;

/** 按标点把一句话切成分句(动词/否定的作用域边界)。不切「和/与」—— 那是同动词的多镜号连接。 */
function splitClauses(text: string): string[] {
  return (text || '').split(/[,,、;;。!!??\n\r]+/).map((s) => s.trim()).filter(Boolean);
}

/** 分句里 `verbRe` 是否被否定:否定词出现在动词**之前**(索引更早)才算。 */
function isNegatedBefore(clause: string, verbRe: RegExp): boolean {
  const neg = clause.match(NEG_RE);
  if (!neg) return false;
  const verb = clause.match(verbRe);
  if (!verb) return false;
  return (neg.index ?? 0) <= (verb.index ?? Number.MAX_SAFE_INTEGER);
}

/** 主解析:自然语言 → 编辑意图列表(可多条)。纯函数,不执行。 */
export function parseEditIntent(text: string): EditIntentResult {
  const t = (text || '').toLowerCase();
  const raw = text || '';
  const intents: EditOp[] = [];
  const seen = new Set<string>();
  const push = (op: EditOp) => {
    const k = JSON.stringify(op);
    if (!seen.has(k)) { seen.add(k); intents.push(op); }
  };

  // 字幕风格
  if (/卡点|卡拉ok|卡拉 ok|karaoke|扫光|逐字|词级/.test(t)) push({ op: 'setCaptionStyle', value: 'karaoke' });
  else if (/大字|醒目|加粗|bold|粗体/.test(t)) push({ op: 'setCaptionStyle', value: 'bold' });
  else if (/社交|social/.test(t)) push({ op: 'setCaptionStyle', value: 'social' });
  else if (/简洁字幕|干净字幕|clean|素字幕/.test(t)) push({ op: 'setCaptionStyle', value: 'clean' });

  // 平台安全区。小红书英文名「RED」太短、易撞词(alf-red / hat-red / 甚至颜色 red)——
  // 只认 rednote / 小红书 / xiaohongshu / xhs 这些不会误伤的写法,不收裸 red。
  if (/抖音|douyin|tiktok/.test(t)) push({ op: 'setPlatform', value: 'douyin' });
  else if (/小红书|xiaohongshu|rednote|xhs/.test(t)) push({ op: 'setPlatform', value: 'xiaohongshu' });

  // 画幅
  if (/竖屏|竖版|9:16|9：16|vertical|portrait/.test(t)) push({ op: 'setAspect', value: '9:16' });
  else if (/横屏|横版|16:9|16：9|landscape|wide/.test(t)) push({ op: 'setAspect', value: '16:9' });

  // 节奏(复用一句指令调风格的词表精神)
  if (FAST_WORDS.some((w) => t.includes(w))) push({ op: 'setPace', value: 'fast' });
  else if (SLOW_WORDS.some((w) => t.includes(w))) push({ op: 'setPace', value: 'slow' });

  // ——— 破坏性操作:逐分句处理,动词/否定/镜号都限定在同一分句内 ———
  const clauses = splitClauses(raw);

  // 重配音(全局动作,无镜号):任一分句命中且未被否定才发。
  if (clauses.some((c) => REVOICE_RE.test(c.toLowerCase()) && !isNegatedBefore(c.toLowerCase(), REVOICE_RE))) {
    push({ op: 'regenVoiceover' });
  }

  // 删镜 / 重生镜(带镜号):每个分句用**自己**的动词判定,互不串扰;否定则整条跳过。
  for (const clause of clauses) {
    const ct = clause.toLowerCase();
    const segShots = extractShotNumbers(clause);
    if (!segShots.length) continue;

    const wantsDrop = DROP_RE.test(ct);
    const wantsRegen = REGEN_RE.test(ct);
    if (!wantsDrop && !wantsRegen) continue;

    // 否定该分句里的破坏性动词 → 绝不发出意图(避免「不要删第3镜」被反向执行)。
    if (wantsDrop && isNegatedBefore(ct, DROP_RE)) continue;
    if (!wantsDrop && wantsRegen && isNegatedBefore(ct, REGEN_RE)) continue;

    for (const n of segShots) {
      if (wantsDrop) push({ op: 'dropShot', shotNumber: n });
      else push({ op: 'regenShot', shotNumber: n, note: clause.trim().slice(0, 200) });
    }
  }

  return { intents, unmatched: intents.length === 0 };
}

/** 把意图列表翻成人话,给前端「我将:…」确认卡用。 */
export function describeIntents(intents: EditOp[]): string[] {
  return intents.map((it) => {
    switch (it.op) {
      case 'setCaptionStyle': return `字幕风格 → ${({ clean: '简洁', social: '社交', bold: '醒目大字', karaoke: '卡点扫光' } as const)[it.value]}`;
      case 'setPlatform': return `平台安全区 → ${({ douyin: '抖音', xiaohongshu: '小红书', none: '无' } as const)[it.value]}`;
      case 'setAspect': return `画幅 → ${it.value === '9:16' ? '竖屏 9:16' : '横屏 16:9'}`;
      case 'setPace': return `剪辑节奏 → ${it.value === 'fast' ? '快节奏燃向' : '慢叙抒情'}`;
      case 'dropShot': return `删除第 ${it.shotNumber} 镜`;
      case 'regenVoiceover': return '重新生成配音';
      case 'regenShot': return `重生第 ${it.shotNumber} 镜${it.note ? `(按:${it.note.slice(0, 40)})` : ''}`;
    }
  });
}

/** 意图是否含花钱/不可逆的破坏性操作 —— 前端应对这些做二次确认。 */
export function hasDestructiveIntent(intents: EditOp[]): boolean {
  return intents.some((it) => it.op === 'dropShot' || it.op === 'regenShot' || it.op === 'regenVoiceover');
}
