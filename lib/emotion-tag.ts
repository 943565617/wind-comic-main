/**
 * 情绪 → MiniMax TTS emotion 枚举映射(v12.211.0,纯函数)。
 *
 * 病根:orchestrator 把 shot.emotion 的**中文自由文本**(如「悲伤」「激动」)直接透传给
 * MiniMax voice_setting.emotion,但官方只认 7 个英文枚举(happy/sad/angry/fearful/
 * disgusted/surprised/neutral)—— 中文被忽略,情感 TTS 从未真正生效。本函数把中文情绪词
 * 归一到合法枚举,让 speech-2.8-hd 的情感表达真正接通。无法识别 → neutral(安全)。
 */

export type MinimaxEmotion = 'happy' | 'sad' | 'angry' | 'fearful' | 'disgusted' | 'surprised' | 'neutral';

const MINIMAX_EMOTIONS: MinimaxEmotion[] = ['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'neutral'];

const RULES: Array<{ re: RegExp; tag: MinimaxEmotion }> = [
  { re: /悲|哭|伤|难过|委屈|凄|哀|落寞|失落|痛/, tag: 'sad' },
  { re: /怒|愤|暴|恼|火|气愤|狂躁/, tag: 'angry' },
  { re: /惧|怕|恐|惊恐|畏|胆怯|不安|紧张|慌/, tag: 'fearful' },
  { re: /厌|恶|嫌|反感|鄙|嫌弃/, tag: 'disgusted' },
  { re: /惊|讶|震惊|意外|吃惊|愕/, tag: 'surprised' },
  { re: /喜|乐|笑|兴奋|激动|欢|开心|愉|欣|雀跃|亢奋|甜/, tag: 'happy' },
  { re: /平静|冷静|淡|中性|沉稳|镇定/, tag: 'neutral' },
];

/** 中文/英文情绪词 → MiniMax emotion 枚举;命中枚举原样返回;无法识别 → neutral。 */
export function emotionToMinimaxEmotion(emotion?: string | null): MinimaxEmotion {
  const e = (emotion || '').trim().toLowerCase();
  if (!e) return 'neutral';
  if ((MINIMAX_EMOTIONS as string[]).includes(e)) return e as MinimaxEmotion;
  for (const { re, tag } of RULES) if (re.test(emotion || '')) return tag;
  return 'neutral';
}

/** 分镜 emotionTag 枚举(与 MinimaxEmotion 同集,供剧本 schema/前端选择器复用)。 */
export const EMOTION_TAGS = MINIMAX_EMOTIONS;
