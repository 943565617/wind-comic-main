/**
 * AI 问书(v12.194.0)—— 长篇小说 → 结构化档案(对标阅文「5 分钟理解百万字」MVP)。
 *
 * 百万字进不了单次上下文 → **三段采样**(开头 40K + 中段 20K + 结尾 20K 字符):
 * 人物/设定多在开头立起,关系演变看中段,结局张力看尾段 —— 采样偏差诚实标注在输出。
 * 纯函数:采样 + prompt 构造;LLM 调用在路由层。
 */

export interface StoryProfile {
  title?: string;
  characters: Array<{ name: string; role: string; traits: string; relationships: string }>;
  settings: Array<{ term: string; definition: string }>;
  highlights: Array<{ scene: string; why: string; positionHint: string }>;
  sampledOnly?: boolean;
}

const HEAD = 40_000, MID = 20_000, TAIL = 20_000;

/** 三段采样:全文 ≤80K 原样;超长取头/中/尾并标记。 */
export function sampleLongText(text: string): { sample: string; sampledOnly: boolean } {
  const t = (text || '').trim();
  if (t.length <= HEAD + MID + TAIL) return { sample: t, sampledOnly: false };
  const midStart = Math.floor(t.length / 2 - MID / 2);
  const sample = [
    '【开头节选】\n' + t.slice(0, HEAD),
    '【中段节选】\n' + t.slice(midStart, midStart + MID),
    '【结尾节选】\n' + t.slice(-TAIL),
  ].join('\n\n…(采样省略)…\n\n');
  return { sample, sampledOnly: true };
}

export function buildAnalyzePrompt(): string {
  return `你是资深剧本改编策划。通读小说文本,输出严格 JSON(不要任何评论):
{
  "title": "书名(文本可辨则填)",
  "characters": [{ "name": "人物名", "role": "主角/反派/关键配角", "traits": "外形+性格 ≤40字", "relationships": "与其他人物的关系 ≤40字" }],
  "settings": [{ "term": "世界观/技能/组织名词", "definition": "≤30字解释" }],
  "highlights": [{ "scene": "高光情节一句话", "why": "为什么适合做剧集钩子 ≤25字", "positionHint": "开头/中段/结尾" }]
}
规则:characters ≤8 个(按戏份排序);settings ≤10;highlights 5-8 条且冲突/反转优先;全部用原文语言。`;
}
