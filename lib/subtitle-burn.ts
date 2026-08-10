/**
 * v3.5 — 字幕烧录平台预设.
 *
 * 不同平台的"爆款字幕"风格不一样: 抖音大白字粗黑边居中偏下, 小红书细字暖色,
 * YouTube 规矩白字黑底. 这文件把这些固化成预设, 生成 ffmpeg `subtitles` 滤镜的
 * `force_style` 串, 一键烧录.
 *
 * 纯函数, 单测: tests/v3-5-subtitle-burn.test.ts.
 */

export type SubtitlePlatform = 'douyin' | 'kuaishou' | 'xiaohongshu' | 'youtube' | 'tiktok' | 'default';

export interface SubtitleStyle {
  /** 字体名 (系统需装, 否则 ffmpeg 回退默认). */
  fontName: string;
  /** 字号 (基于 1080p, ffmpeg 按 PlayResY 缩放). */
  fontSize: number;
  /** 主色, ASS BGR hex `&HBBGGRR`. */
  primaryColour: string;
  /** 描边色. */
  outlineColour: string;
  /** 描边粗细 px. */
  outline: number;
  /** 阴影 px. */
  shadow: number;
  /** 底部边距 px. */
  marginV: number;
  /** ASS 对齐 (numpad: 2=底中, 5=正中, 8=顶中). */
  alignment: number;
  /** 是否加粗 (-1 = 是, 0 = 否, ASS 约定). */
  bold: number;
  /** v12.212:半透明底板色(ASS BackColour &HAABBGGRR);配 borderStyle=4 用. */
  backColour?: string;
  /** v12.212:1=描边+阴影(默认) 4=不透明底板(社媒复杂背景可读性更强). */
  borderStyle?: number;
}

/**
 * v12.234(二轮对抗复检 · 🟡-27 真正的缺口):CJK 平台预设此前把 fontName 写死为 macOS 专有字体名。
 *
 * v12.233 改了 `lib/text-control.ts` 的 findCjkFont() 让它开源优先,并对外宣称「字体 EULA 已合规」——
 * 但**字幕烧录主路径根本不经过 findCjkFont**:它走 getSubtitleStyle() → PRESETS.fontName → ASS force_style。
 * 也就是说抖音/快手/小红书的成片字幕,自始至终指名要 Apple 专有字体(EULA 不允许随片分发字形)。
 * 改了解析函数却没跟到真正的消费方 —— 与本轮 video-composer 那两处是同一个病。
 *
 * 现在:预设里放占位符,`getSubtitleStyle()` 出口处解析成**本机实际可用的开源 CJK 字体名**;
 * 一个都找不到时退到 'Noto Sans CJK SC' 这个开源名,让 libass 自行替换并留下告警。
 */
const CJK_AUTO = '__cjk_auto__';

let cjkNameCache: string | null = null;
export function resolveCjkFontName(): string {
  if (cjkNameCache) return cjkNameCache;
  let name = 'Noto Sans CJK SC'; // 兜底用开源字体名,绝不回落到系统专有字体
  try {
    // 延迟 require:本模块被大量纯字符串测试引用,不该在 import 期就摸文件系统
    const { findCjkFont, isOpenLicenseFont } = require('./text-control') as typeof import('./text-control');
    const p = findCjkFont();
    if (p && isOpenLicenseFont(p)) {
      const base = p.split('/').pop() || '';
      name = base.replace(/\.(otf|ttf|ttc)$/i, '');
    }
  } catch { /* 解析失败就用开源兜底名 */ }
  cjkNameCache = name;
  return name;
}

const PRESETS: Record<SubtitlePlatform, SubtitleStyle> = {
  // 抖音: 大白字 + 粗黑边 + 居中偏下, 信息密度高也看得清
  douyin: {
    fontName: CJK_AUTO, fontSize: 56, primaryColour: '&H00FFFFFF',
    outlineColour: '&H00000000', outline: 4, shadow: 1, marginV: 120, alignment: 2, bold: -1, borderStyle: 4, backColour: '&H99000000',
  },
  // 快手: 比抖音更大更粗, 下沉一点
  kuaishou: {
    fontName: CJK_AUTO, fontSize: 60, primaryColour: '&H00FFFFFF',
    outlineColour: '&H00000000', outline: 5, shadow: 1, marginV: 140, alignment: 2, bold: -1, borderStyle: 4, backColour: '&H99000000',
  },
  // 小红书: 细一点, 暖白, 描边淡, 偏精致
  xiaohongshu: {
    fontName: CJK_AUTO, fontSize: 48, primaryColour: '&H00F0F8FF',
    outlineColour: '&H00404040', outline: 2, shadow: 0, marginV: 160, alignment: 2, bold: 0,
  },
  // YouTube: 规矩白字黑描边, 字号适中
  youtube: {
    fontName: 'Arial', fontSize: 44, primaryColour: '&H00FFFFFF',
    outlineColour: '&H00000000', outline: 3, shadow: 1, marginV: 60, alignment: 2, bold: 0,
  },
  // TikTok: 竖屏大白字粗描边, 上抬避开右侧操作栏/底部话题, 与抖音同源略瘦
  tiktok: {
    fontName: 'Arial', fontSize: 52, primaryColour: '&H00FFFFFF',
    outlineColour: '&H00000000', outline: 4, shadow: 1, marginV: 180, alignment: 2, bold: -1, borderStyle: 4, backColour: '&H99000000',
  },
  default: {
    fontName: CJK_AUTO, fontSize: 50, primaryColour: '&H00FFFFFF',
    outlineColour: '&H00000000', outline: 3, shadow: 1, marginV: 100, alignment: 2, bold: 0,
  },
};

export function listSubtitlePlatforms(): SubtitlePlatform[] {
  return Object.keys(PRESETS) as SubtitlePlatform[];
}

/**
 * v12.180:按语种/平台选跨平台字体 —— PRESETS 硬编码 PingFang SC(macOS 专有),
 * Linux 部署烧韩/俄字幕会静默豆腐块。优先级:SUBTITLE_FONT env > 语种专属 > 平台预设原值(mac 上仍最优)。
 * Linux 部署方需安装 fonts-noto-cjk / fonts-noto-core(README 部署节已述)。
 */
export function fontForLanguage(lang?: string | null, presetFont?: string, env: Record<string, string | undefined> = process.env, platform: string = typeof process !== 'undefined' ? process.platform : 'linux'): string | null {
  if (env.SUBTITLE_FONT) return env.SUBTITLE_FONT;
  const l = (lang || '').toLowerCase();
  const isDarwin = platform === 'darwin';
  // v12.236(第三轮对抗复检):darwin 分支原本返回 'Apple SD Gothic Neo' / 'Hiragino Sans' ——
  // 都是 Apple 专有字体,EULA 不允许随商用成片分发字形。v12.234 只把 PRESETS 的中文档改掉了,
  // ko/ja 这两条**语种覆盖**会在出口处把已解析好的开源字体名整个替换回专有名 —— 又是漏了侧门。
  // 现在统一给开源名(Noto Sans KR/JP,SIL OFL);本机没装则由 libass 自行替换,与其他语种同待遇。
  if (l === 'ko') return 'Noto Sans KR';
  if (l === 'ja') return 'Noto Sans JP';
  if (l === 'ru' || l === 'de' || l === 'fr' || l === 'es' || l === 'pt') return isDarwin ? (presetFont || null) : 'DejaVu Sans';
  if (l === 'zh') return isDarwin ? (presetFont || null) : 'Noto Sans CJK SC';
  return null; // 未指定语种 → 不覆盖预设(YouTube 等西文平台的 Arial 必须保留;CI Linux 抓到的真行为 bug)
}

/** 取平台预设. 未知平台回退 default. 返回拷贝, 防外部 mutate. lang 可选 —— 语种字体覆盖(v12.180). */
export function getSubtitleStyle(platform: SubtitlePlatform | string, lang?: string | null): SubtitleStyle {
  const p = (PRESETS as Record<string, SubtitleStyle>)[platform];
  const style = { ...(p ?? PRESETS.default) };
  const f = fontForLanguage(lang, style.fontName);
  if (f) style.fontName = f;
  // v12.234:占位符在**唯一出口**解析成实际字体名 —— 放这里而非 PRESETS 定义处,
  // 是为了不在模块 import 期摸文件系统(纯字符串测试不该被 fs 状态左右)。
  if (style.fontName === CJK_AUTO) style.fontName = resolveCjkFontName();
  return style;
}

/** 允许在预设基础上覆盖个别字段. */
export function getSubtitleStyleWithOverrides(
  platform: SubtitlePlatform | string,
  overrides: Partial<SubtitleStyle> = {},
): SubtitleStyle {
  return { ...getSubtitleStyle(platform), ...overrides };
}

/** SubtitleStyle → ASS force_style 串 (逗号分隔 K=V). */
export function styleToForceStyle(style: SubtitleStyle): string {
  const pairs: Array<[string, string | number]> = [
    ['FontName', style.fontName],
    ['FontSize', style.fontSize],
    ['PrimaryColour', style.primaryColour],
    ['OutlineColour', style.outlineColour],
    ['Outline', style.outline],
    ['Shadow', style.shadow],
    ['MarginV', style.marginV],
    ['Alignment', style.alignment],
    ['Bold', style.bold],
  ];
  // v12.212:软化描边边缘(硬描边在高分屏发糊/锯齿),libass 原生 Blur;有底板时追加 BackColour+BorderStyle
  if (style.borderStyle != null) { pairs.push(['BorderStyle', style.borderStyle]); if (style.backColour) pairs.push(['BackColour', style.backColour]); }
  pairs.push(['Blur', 0.6]);
  return pairs.map(([k, v]) => `${k}=${v}`).join(',');
}

/** ffmpeg path 转义 — `:` `'` `\` 在 filtergraph 里有特殊含义, 要转义. */
export function escapeSubtitlePath(p: string): string {
  // filtergraph: 反斜杠先转, 再转冒号 (Windows 盘符) 和单引号
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/**
 * 生成完整的 `-vf subtitles=...` 滤镜串.
 * @param srtOrAssPath 字幕文件路径 (.srt / .ass)
 * @param platform 平台预设
 * @param overrides 覆盖字段
 */
export function buildSubtitlesFilter(
  srtOrAssPath: string,
  platform: SubtitlePlatform | string = 'default',
  overrides: Partial<SubtitleStyle> = {},
  lang?: string | null, // v12.180:目标语种(字体覆盖:ko/ja/ru 等跨平台可显)
): string {
  if (!srtOrAssPath) throw new Error('buildSubtitlesFilter: empty subtitle path');
  const style = getSubtitleStyleWithOverrides(platform, overrides);
  if (!overrides.fontName) { // 显式覆盖优先;否则按语种/平台选可显字体
    const f = fontForLanguage(lang, style.fontName);
    if (f) style.fontName = f;
  }
  // v12.196 live 截帧抓到的真 bug:SRT 走 libass 默认 PlayResY=288 坐标系,而 PRESETS
  // 按 1080 设计 —— FontSize=56 渲成 37% 屏高巨字,MarginV=120+ 直接把字幕顶到画面上部。
  // 显式声明 PlayResY=1080 后,预设值在任何输出分辨率下按比例正确落位(libass 字号/边距均按 Y 轴缩放)。
  const force = `${styleToForceStyle(style)},PlayResY=1080`;
  const escaped = escapeSubtitlePath(srtOrAssPath);
  return `subtitles='${escaped}':force_style='${force}'`;
}
