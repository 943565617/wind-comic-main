/**
 * lib/language-detect (v12.6.1 · #2;v12.134 扩展多语种 + 显式选择) — 目标语种检测 + 贯穿约束。
 *
 * 用户反馈:生成前要按输入语种限制语种(避免台词/旁白语种漂移或中英混杂)。
 * 自动检测只分 zh/en;issue #2 功能请求要「生成前显式选语言(俄/英等)」→ 加语种注册表 +
 * `normalizeLanguage`(把用户选的 code/别名归一)。LLM 能写多语,TTS(MiniMax 多语)覆盖主流语种;
 * 口型模型只有 zh/en 音素 → 其它语种 lipsync 退回 en 近似(诚实降级,见 ttsReliable/lipsync)。
 * visualPrompt 仍保持英文 —— 它喂视频引擎,不属「内容语种」。
 */
export type TargetLanguage = 'zh' | 'en' | 'ja' | 'ko' | 'es' | 'fr' | 'ru' | 'de' | 'pt';

interface LangMeta {
  ttsCode: string;          // TTS 语种码(MiniMax/OpenAI 兼容)
  lipsync: 'zh' | 'en' | 'none'; // 口型模型只有中/英音素;差异过大的语种标 none(v12.179:错口型比无口型更伤观感)
  enName: string;           // 英文名(注入 LLM 铁律用)
  nativeName: string;       // 母语名(UI 展示 + LLM 铁律用)
  ttsReliable: boolean;     // TTS 是否可靠出声(false → 只保证剧本/字幕,配音降级)
}

/** 支持的语种注册表(TTS 走 MiniMax 多语;口型 zh/en 原生、其余近似)。 */
export const SUPPORTED_LANGUAGES: Record<TargetLanguage, LangMeta> = {
  zh: { ttsCode: 'zh-CN', lipsync: 'zh', enName: 'Chinese', nativeName: '简体中文', ttsReliable: true },
  en: { ttsCode: 'en-US', lipsync: 'en', enName: 'English', nativeName: 'English', ttsReliable: true },
  ja: { ttsCode: 'ja-JP', lipsync: 'none', enName: 'Japanese', nativeName: '日本語', ttsReliable: true }, // v12.196:日语音素与英语差距不亚于韩俄,错口型比无口型更伤 → 与 ko/ru 同策略
  ko: { ttsCode: 'ko-KR', lipsync: 'none', enName: 'Korean', nativeName: '한국어', ttsReliable: true },
  es: { ttsCode: 'es-ES', lipsync: 'en', enName: 'Spanish', nativeName: 'Español', ttsReliable: true },
  fr: { ttsCode: 'fr-FR', lipsync: 'en', enName: 'French', nativeName: 'Français', ttsReliable: true },
  ru: { ttsCode: 'ru-RU', lipsync: 'none', enName: 'Russian', nativeName: 'Русский', ttsReliable: true },
  de: { ttsCode: 'de-DE', lipsync: 'en', enName: 'German', nativeName: 'Deutsch', ttsReliable: true },
  pt: { ttsCode: 'pt-BR', lipsync: 'en', enName: 'Portuguese', nativeName: 'Português', ttsReliable: true },
};

/** 从创意文本判主语种:几乎纯拉丁→en,含相当量 CJK→zh(漫剧默认 zh)。仅区分 zh/en(细分语种靠显式选)。 */
export function detectLanguage(text: string | null | undefined): TargetLanguage {
  if (!text) return 'zh';
  const cjk = (text.match(/[一-鿿぀-ヿ가-힯]/g) || []).length;
  const latin = (text.match(/[a-zA-Z]/g) || []).length;
  if (cjk === 0 && latin > 0) return 'en';      // 纯拉丁 → 英文
  if (cjk === 0 && latin === 0) return 'zh';     // 无字母(纯标点/数字)→ 默认中文
  // CJK 信息密度高:CJK 字数 ×4 ≥ 拉丁字母数 即判中文(容忍少量英文品牌名/术语)
  return cjk * 4 >= latin ? 'zh' : 'en';
}

/** 用户输入(code/别名/母语名)→ 规范语种。'auto'/空/不认识 → 回退到文本自动检测。 */
const LANG_ALIASES: Record<string, TargetLanguage> = {
  zh: 'zh', 'zh-cn': 'zh', 'zh-hans': 'zh', chinese: 'zh', mandarin: 'zh', 中文: 'zh', 简体中文: 'zh', 中文简体: 'zh',
  en: 'en', 'en-us': 'en', 'en-gb': 'en', english: 'en', 英文: 'en', 英语: 'en',
  ja: 'ja', jp: 'ja', 'ja-jp': 'ja', japanese: 'ja', 日本語: 'ja', 日语: 'ja', 日文: 'ja',
  ko: 'ko', 'ko-kr': 'ko', korean: 'ko', 한국어: 'ko', 韩语: 'ko', 韩文: 'ko',
  es: 'es', 'es-es': 'es', spanish: 'es', 'español': 'es', 西班牙语: 'es', 西语: 'es',
  fr: 'fr', 'fr-fr': 'fr', french: 'fr', 'français': 'fr', 法语: 'fr', 法文: 'fr',
  ru: 'ru', 'ru-ru': 'ru', russian: 'ru', 'русский': 'ru', 俄语: 'ru', 俄文: 'ru',
  de: 'de', 'de-de': 'de', german: 'de', deutsch: 'de', 德语: 'de', 德文: 'de',
  pt: 'pt', 'pt-br': 'pt', portuguese: 'pt', 'português': 'pt', 葡萄牙语: 'pt', 葡语: 'pt',
};

export function isSupportedLanguage(x: unknown): x is TargetLanguage {
  return typeof x === 'string' && x in SUPPORTED_LANGUAGES;
}

/** 规范化用户选择:命中注册表/别名 → 该语种;'auto'/空/未知 → 按 fallbackText 自动检测。 */
export function normalizeLanguage(input: string | null | undefined, fallbackText?: string | null): TargetLanguage {
  const key = (input || '').trim().toLowerCase();
  if (!key || key === 'auto') return detectLanguage(fallbackText);
  if (isSupportedLanguage(key)) return key;
  if (LANG_ALIASES[key]) return LANG_ALIASES[key];
  return detectLanguage(fallbackText);
}

/** TTS 语种码(minimax / openai 兼容)。 */
export function ttsLangCode(lang: TargetLanguage): string {
  return SUPPORTED_LANGUAGES[lang]?.ttsCode ?? 'zh-CN';
}

/** 口型对齐语种码(仅 zh/en 音素;其余近似 en)。 */
export function lipsyncLangCode(lang: TargetLanguage): 'zh' | 'en' | 'none' {
  return SUPPORTED_LANGUAGES[lang]?.lipsync ?? 'zh';
}

/** TTS 是否可靠出声(false 时调用方应提示「配音降级/仅字幕」)。 */
export function ttsReliable(lang: TargetLanguage): boolean {
  return SUPPORTED_LANGUAGES[lang]?.ttsReliable ?? false;
}

export function languageDisplayName(lang: TargetLanguage): string {
  return SUPPORTED_LANGUAGES[lang]?.nativeName ?? '简体中文';
}

/** UI 下拉用:全部支持语种的展示列表(含母语名 + TTS 可靠标记)。 */
export function listSupportedLanguages(): Array<{ code: TargetLanguage; nativeName: string; enName: string; ttsReliable: boolean }> {
  return (Object.keys(SUPPORTED_LANGUAGES) as TargetLanguage[]).map((code) => ({
    code, nativeName: SUPPORTED_LANGUAGES[code].nativeName, enName: SUPPORTED_LANGUAGES[code].enName, ttsReliable: SUPPORTED_LANGUAGES[code].ttsReliable,
  }));
}

/** 注入 Writer prompt 的语种铁律块 —— 锁台词/旁白/场景描述语种,visualPrompt 仍英文。 */
export function buildLanguageDirective(lang: TargetLanguage): string {
  if (lang === 'zh') {
    return `

## 🌐 输出语种 = 简体中文(铁律)
所有 \`dialogue\` / 旁白 / \`sceneDescription\` / \`subtext\` / \`action\` / 屏幕文字必须用简体中文,**不要混入整句英文**。
例外:\`visualPrompt\` 仍用英文(喂视频引擎);\`beats[].action\`/\`camera\` 也用英文。`;
  }
  const meta = SUPPORTED_LANGUAGES[lang] ?? SUPPORTED_LANGUAGES.en;
  return `

## 🌐 OUTPUT LANGUAGE = ${meta.enName.toUpperCase()} (${meta.nativeName}) — hard rule
All \`dialogue\`, narration, \`sceneDescription\`, \`subtext\`, \`action\` and any on-screen text MUST be natural ${meta.enName} (${meta.nativeName}). Do NOT output Chinese or any other language in these fields.
Exception: \`visualPrompt\` and \`beats[].action\`/\`camera\` stay English (they feed the video engine).`;
}

/**
 * v12.196:按字符分布嗅探文本语种(SRT 烧录选字体用,零 LLM)。
 * 只认置信度高的三类非拉丁文种;分不清 → null(调用方保持原字体)。
 */
export function sniffTextLanguage(text: string | null | undefined): 'ja' | 'ko' | 'ru' | 'zh' | null {
  const t = (text || '').slice(0, 4000);
  if (!t.trim()) return null;
  const kana = (t.match(/[\u3040-\u30ff]/g) || []).length;
  const hangul = (t.match(/[\uac00-\ud7af]/g) || []).length;
  const cyr = (t.match(/[\u0400-\u04ff]/g) || []).length;
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  if (kana >= 4) return 'ja';           // 有假名基本必是日语
  if (hangul >= 4) return 'ko';
  if (cyr >= 8) return 'ru';
  if (cjk >= 8) return 'zh';
  return null;
}
