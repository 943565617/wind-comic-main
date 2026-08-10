/**
 * 剧本语种守门(v12.166.0)—— 目标语种 ≠ 中文时,LLM 常被中文素材带偏
 * (system 端铁律被忽视,台词照写中文;live 实测:language=ja 出稿全中文台词)。
 * 双保险的「产后守门」环:检测 shots 台词语种 → 不符时给出仅翻译文案字段的修复指令。
 * 纯函数(检测/判定/修复 prompt),LLM 调用留在 orchestrator。
 */
import type { TargetLanguage } from './language-detect';

/** 粗粒度文本语种特征检测(够守门用,不做全语种识别)。 */
export function textMatchesLanguage(text: string, lang: TargetLanguage): boolean {
  const t = (text || '').trim();
  if (!t) return true; // 空文案不判
  const kana = (t.match(/[぀-ヿ]/g) || []).length;        // 平假名+片假名
  const hangul = (t.match(/[가-힯]/g) || []).length;
  const cyrillic = (t.match(/[Ѐ-ӿ]/g) || []).length;
  const cjk = (t.match(/[一-鿿]/g) || []).length;
  const latin = (t.match(/[a-zA-Z]/g) || []).length;
  const total = kana + hangul + cyrillic + cjk + latin;
  if (total < 4) return true; // 太短(拟声/感叹/标点)不判 —— 'OK!' 这类不应误伤
  switch (lang) {
    // 日语:假名密度 ≥20%(纯汉字是中文;「見ない。心动就试试…」混语句 kana 4/20 也应判不符 ——
    // 正常日语句助词/送假名密度远高于此)
    case 'ja': return kana > 0 && kana / (kana + cjk || 1) >= 0.2;
    case 'ko': return hangul / total > 0.5;
    case 'ru': return cyrillic / total > 0.5;
    case 'zh': return cjk / total > 0.3 && kana === 0 && hangul === 0;
    case 'en': case 'es': case 'fr': case 'de': case 'pt':
      return latin / total > 0.7 && cjk === 0;
    default: return true;
  }
}

/** 抽取剧本的文案字段样本(台词/旁白优先),返回不符语种的样本数与总数。 */
export function scriptLanguageMismatch(script: any, lang: TargetLanguage): { checked: number; mismatched: number } {
  const shots: any[] = Array.isArray(script?.shots) ? script.shots : [];
  let checked = 0, mismatched = 0;
  for (const s of shots) {
    for (const field of ['dialogue', 'narration'] as const) {
      const v = s?.[field];
      if (typeof v === 'string' && v.trim().length >= 2) {
        checked++;
        if (!textMatchesLanguage(v, lang)) mismatched++;
      }
    }
  }
  return { checked, mismatched };
}

/** 守门判定:有效样本 ≥2 且过半不符 → 需要修复。 */
export function needsLanguageFix(script: any, lang: TargetLanguage): boolean {
  if (lang === 'zh') return false; // 中文是素材母语,不会被带偏
  const { checked, mismatched } = scriptLanguageMismatch(script, lang);
  return checked >= 2 && mismatched * 2 >= checked; // 半数即修(样本少时宁修勿漏)
}

/** 修复指令:只翻译文案字段,结构/视觉字段原样保留(输出体量小,一次便宜调用)。 */
export function buildLanguageFixPrompt(langEnName: string, langNativeName: string): string {
  return `You are a professional dubbing-script localizer. The JSON screenplay below has dialogue written in the WRONG language.
Rewrite ONLY these fields into natural, colloquial ${langEnName} (${langNativeName}): \`title\`, \`logline\`, and each shot's \`dialogue\`, \`narration\`, \`subtext\`, plus any on-screen caption text fields.
Keep EVERYTHING else byte-identical: shotNumber, duration, visualPrompt, sceneDescription, beats, camera fields, structure and key order.
Return the complete corrected JSON only — no commentary.`;
}
