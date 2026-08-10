/**
 * 词级动效字幕(ASS karaoke,v12.54.0)。
 *
 * 调研「embedded-captions」动效字幕 → 落地词级高亮:字幕随配音逐字「亮起」(karaoke 扫光),
 * 短视频/电商成片的节奏感与可读性显著上一档。
 *
 * 时间轴说明:TTS provider 返回的是**行级**时间(整句 start/end,见 vectorengine-tts),无字级时间戳;
 * 故这里把每句时长**均摊到字**(CJK 逐字、连续 ASCII 词整体)合成 `\kf` 扫光 —— 不依赖 TTS 字级数据、
 * 零外部依赖,视觉上与配音同步(精度到句级,字内为线性扫光)。纯函数产 ASS 文本,libass(ffmpeg 已用)渲染。
 */

export interface KaraokeLine {
  text: string;
  startSec: number;
  durSec: number;
  /** v12.68.0:扫光实际时长(=该句 TTS 音频真实时长)。缺省 = durSec(均摊,旧行为)。
   *  配音 2s 说完而镜长 4s 时,扫光 2s 内完成、其后整句保持高亮 —— 音画同步。 */
  sweepSec?: number;
}

export interface KaraokeAssOptions {
  w: number;
  h: number;
  fontName: string;
  vertical?: boolean;
  /** 已扫过(高亮)字色,ASS &HAABBGGRR。默认亮金。 */
  primaryColour?: string;
  /** 未扫到的底色。默认白。 */
  secondaryColour?: string;
  /** v12.79:字幕底边距占画面高的比例(平台安全区避让)。缺省 竖屏 0.10 / 横屏 0.08。 */
  marginVRatio?: number;
}

/** 秒 → ASS 时间 H:MM:SS.cs(厘秒)。 */
export function assTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  const cs2 = cs === 100 ? 99 : cs; // 防进位越界
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cs2).padStart(2, '0')}`;
}

/** 把一行切成 token:CJK/标点逐字;连续 ASCII 字母数字合成一个词(英文整词高亮)。 */
export function tokenizeForKaraoke(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  for (const ch of (text || '').trim()) {
    if (/[A-Za-z0-9'’]/.test(ch)) {
      buf += ch;
    } else {
      if (buf) { out.push(buf); buf = ''; }
      if (ch === ' ') { if (out.length) out[out.length - 1] += ' '; } // 空格并入前词,不单独成 token
      else out.push(ch);
    }
  }
  if (buf) out.push(buf);
  return out;
}

/** v12.117:token 显示宽(以字号为单位):CJK≈1,ASCII/半角≈0.5。 */
export function tokenDisplayWidth(t: string): number {
  let w = 0;
  for (const ch of t) w += ch.charCodeAt(0) <= 0xff ? 0.5 : 1;
  return w;
}

/**
 * v12.117 长行折行(纯函数):总宽超预算时在 token 边界断成 2 行(字幕惯例上限)。
 * 断点选「两行最均衡」处,紧跟标点的断点加权优先(读感自然)。WrapStyle:2 下 libass
 * 不自动折行 —— 竖屏 720 宽/96px 字号只装 ~6 个汉字,长台词此前直接溢出画面。
 */
export function wrapKaraokeTokens(tokens: string[], budget: number): string[][] {
  const total = tokens.reduce((a, t) => a + tokenDisplayWidth(t), 0);
  if (total <= budget || tokens.length < 2) return [tokens];
  const half = total / 2;
  const PUNCT = /[,。!?、;:,.!?;:…]\s*$/;
  let acc = 0; let best = 0; let bestScore = Infinity;
  for (let i = 0; i < tokens.length - 1; i++) {
    acc += tokenDisplayWidth(tokens[i]);
    const score = Math.abs(acc - half) - (PUNCT.test(tokens[i]) ? 1.5 : 0);
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return [tokens.slice(0, best + 1), tokens.slice(best + 1)];
}

/** 单行 → 带 `\kf` 的 ASS 文本(厘秒均摊,余数给末 token)。
 *  v12.117:传 budget(字号单位宽)时超宽自动折 2 行(`\N`,扫光跨行连续)。 */
export function buildKaraokeLineText(text: string, durSec: number, budget?: number): string {
  const tokens = tokenizeForKaraoke(text);
  if (tokens.length === 0) return '';
  const rows = budget && budget > 0 ? wrapKaraokeTokens(tokens, budget) : [tokens];
  const flat = rows.flat();
  const totalCs = Math.max(1, Math.round(durSec * 100));
  const per = Math.floor(totalCs / flat.length);
  let used = 0;
  const renderTok = (t: string, isLast: boolean) => {
    const cs = isLast ? totalCs - used : per;
    used += cs;
    // 转义 ASS 花括号/反斜杠(token 里出现的话)
    const safe = t.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
    return `{\\kf${cs}}${safe}`;
  };
  let idx = 0;
  return rows
    .map((row) => row.map((t) => renderTok(t, ++idx === flat.length)).join(''))
    .join('\\N');
}

/** 生成完整 ASS 文件文本(卡拉OK扫光字幕)。 */
export function buildKaraokeAss(lines: KaraokeLine[], opts: KaraokeAssOptions): string {
  const { w, h, fontName } = opts;
  const vertical = !!opts.vertical;
  const primary = opts.primaryColour || '&H0000D7FF'; // 亮金(已扫)
  const secondary = opts.secondaryColour || '&H00FFFFFF'; // 白(未扫)
  // ASS 用真实分辨率作 PlayRes,字号/边距按高度百分比算(libass 在 PlayResY 坐标系里量字号),
  // 否则像 30 这种绝对值在 1280 高的画布上会非常小。竖屏 ~7.5%H、横屏 ~6%H,抬高避 CTA/UI。
  const fontSize = Math.round(h * (vertical ? 0.075 : 0.06));
  const marginV = Math.round(h * (opts.marginVRatio ?? (vertical ? 0.1 : 0.08)));
  const outline = Math.max(2, Math.round(fontSize * 0.06));

  // V4+ Style:PrimaryColour=扫过色,SecondaryColour=未扫色(karaoke 由二者间扫光),Bold=1,底部居中
  const styleLine = `Style: Default,${fontName},${fontSize},${primary},${secondary},&H00101010,&H64000000,1,0,0,0,100,100,0,0,1,${outline},1,2,40,40,${marginV},1`;

  const events = lines
    .filter((l) => (l.text || '').trim())
    .map((l) => {
      const start = assTime(l.startSec);
      const end = assTime(l.startSec + Math.max(0.2, l.durSec));
      // v12.68.0:扫光按 TTS 真实时长(clamp 到 [0.2, durSec]),显示仍到镜末
      const sweep = Math.max(0.2, Math.min(l.sweepSec ?? l.durSec, l.durSec));
      // v12.117:按画面宽/字号算行宽预算(扣左右 40px 边距),超宽折 2 行;
      // 折完最长行仍超宽(超长台词)→ 行内 {\\fs} 缩字号恰好塞进画面(只缩该句)
      const budget = (w - 80) / fontSize;
      const body = buildKaraokeLineText(l.text, sweep, budget);
      const rows = wrapKaraokeTokens(tokenizeForKaraoke(l.text), budget);
      const maxRowW = Math.max(...rows.map((r) => r.reduce((a, t) => a + tokenDisplayWidth(t), 0)));
      const fsTag = maxRowW > budget ? `{\\fs${Math.floor(fontSize * budget / maxRowW)}}` : '';
      return `Dialogue: 0,${start},${end},Default,,0,0,0,,${fsTag}${body}`;
    });

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    styleLine,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n');
}
