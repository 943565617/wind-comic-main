/**
 * 语种专属音色映射(v12.170.0)—— 「配音即该语种」的音色本土化一步。
 *
 * 现状:多语配音靠 language_boost(v12.168)保证语种正确,但音色仍是默认中文系
 * (发音标准、音色人设不本土)。本模块按目标语种换**语种专属音色**:
 *   优先级:env `TTS_VOICE_<LANG>_<GENDER>`(如 TTS_VOICE_JA_FEMALE)
 *         > env `TTS_VOICE_<LANG>`(不分性别)
 *         > 内置默认表(只收录 MiniMax 文档确认的系统音色;宁缺毋滥)
 *         > null(调用方保持原音色 + language_boost,行为与 v12.168 完全一致)
 * 音色 id 从 MiniMax 控制台「音色管理」页获取后填 env 即生效,零代码改动。
 */

/** 内置默认表:key = `<LANG>` 或 `<LANG>_<GENDER>`。
 * 刻意保守 —— 只放官方文档确认的多语系统音色;不确定的语种留空走 env。 */
const BUILTIN: Record<string, string> = {
  // 例:'JA_FEMALE': 'Japanese_xxx',  // ← 从 MiniMax 控制台确认后填入
};

/** ttsCode('ja-JP')→ env 段名('JA')。 */
export function langKeyOf(ttsCode: string | null | undefined): string | null {
  const m = (ttsCode || '').match(/^([a-z]{2})-/i);
  return m ? m[1].toUpperCase() : null;
}

/** 从基础音色 id 推断性别段('female-zh'/'narrator_female_cn' → FEMALE)。 */
export function genderOf(baseVoiceId: string | null | undefined): 'MALE' | 'FEMALE' {
  return /female|女/i.test(baseVoiceId || '') ? 'FEMALE' : 'MALE';
}

/**
 * 语种专属音色解析;没配置 → null(保持原音色)。
 * @param env 注入以保持纯函数可测(生产传 process.env)
 */
export function voiceForLanguage(
  ttsCode: string | null | undefined,
  baseVoiceId: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const lang = langKeyOf(ttsCode);
  if (!lang || lang === 'ZH') return null; // 中文用现有音色体系,不介入
  const gender = genderOf(baseVoiceId);
  return (
    env[`TTS_VOICE_${lang}_${gender}`] ||
    env[`TTS_VOICE_${lang}`] ||
    BUILTIN[`${lang}_${gender}`] ||
    BUILTIN[lang] ||
    null
  );
}
