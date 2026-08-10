/**
 * v2.22 fix #2 — 漫剧文字处理: 不让模型画文字, 让后期 ffmpeg 烧字幕.
 *
 * 问题:
 *   - 业界主流的图/视频模型 (MJ / Minimax / Hailuo / Sora 2 / Kling) 对 CJK 文字
 *     渲染都很弱 — 把"对白文本"塞进 prompt, 出来就是糊成一团的鬼画符
 *   - 之前 orchestrator 在视频 prompt 里直接拼 `. Speaking: "中文对白"` →
 *     模型尝试画字 → 字幕区域出现一片乱码
 *
 * 解法 (业内成熟做法):
 *   1. 不传 dialogue 文本进 prompt, 只传 "character speaking" 这种语义动作
 *   2. 加 universal 文字 negative prompts (中英都禁)
 *   3. 后期用 ffmpeg `subtitles` filter (libass + .srt) 烧 CJK 字幕, 字体用
 *      系统自带 CJK font (macOS: PingFang, Linux: Noto Sans CJK)
 *
 * 这个 lib 提供:
 *   - sanitizeDialogueForPrompt — 把对白替换成语义描述, 不传原文
 *   - getTextNegativePromptFlags — 统一的 --no text/字 列表 (image)
 *   - buildSrt — 从 shots[] 拼 .srt 字幕文件内容
 *   - findCjkFont — 系统找 CJK 字体, 给 ffmpeg subtitles filter 用
 */

import fs from 'fs';
import path from 'path';

/**
 * 把对白文本替换成语义描述, 让视频模型知道"人物在说话"但不会试图画字.
 *
 * 例:
 *   sanitizeDialogueForPrompt("你这个骗子!", "alice") →
 *     "character alice is speaking emotionally mid-sentence, lips moving naturally"
 *
 * 多角色对话也支持 — 调用方按 shot.characters[0] 传主说话人.
 */
export function sanitizeDialogueForPrompt(
  dialogue: string,
  speakerName?: string,
): string {
  if (!dialogue || !dialogue.trim()) return '';
  const len = dialogue.trim().length;
  // 按长度给视频模型不同节奏 hint — 短语 vs 长篇
  let pace: string;
  if (len <= 10) pace = 'a brief phrase';
  else if (len <= 30) pace = 'a sentence';
  else pace = 'an extended speech';

  const speaker = speakerName && speakerName.trim() ? speakerName.trim() : 'character';
  // 关键: 不传原文, 只传"在说话 + 节奏". 让 lipsync (Kling) 或后期 ffmpeg 字幕去管文本.
  return `${speaker} is speaking ${pace} with natural lip movement, mid-utterance`;
}

/**
 * 统一的"禁止文字"负向 prompt 标志 — 给所有 image/video gen 调用拼到 prompt 末尾.
 *
 * 同时覆盖:
 *   - 英文文字 (text/words/letters/captions/subtitles/typography)
 *   - 中文文字 (chinese characters/汉字/字幕)
 *   - 招牌/海报/书法 (signs/posters/calligraphy)
 *   - 水印 / logo (watermark/logo)
 *
 * 注意: 不同模型对负向 prompt 语法不同
 *   - MJ: --no text --no words --no chinese
 *   - flux/minimax/hailuo: 直接拼 "no text, no captions" 在 prompt 末尾
 *
 * 调用方按引擎选 flavor — 默认返 MJ flavor, opts.flavor='plain' 返普通描述.
 */
export function getTextNegativePromptFlags(opts?: { flavor?: 'mj' | 'plain' }): string {
  const flavor = opts?.flavor || 'mj';
  if (flavor === 'mj') {
    return ' --no text --no words --no letters --no captions --no subtitles --no typography --no chinese --no calligraphy --no signage --no watermark --no logo';
  }
  // plain flavor 拼在正向 prompt 里, 用 "no X" 的语法
  return ', no text, no words, no captions, no subtitles, no chinese characters, no calligraphy on screen, no watermarks';
}

/**
 * 给一镜的 dialogue 输出 srt 格式的字幕条目.
 *
 * @param index   1-based 字幕序号
 * @param startSec  开始秒
 * @param durationSec  持续秒
 * @param text   原始对白文本 (中英都可)
 */
export function buildSrtEntry(
  index: number,
  startSec: number,
  durationSec: number,
  text: string,
): string {
  const fmtTime = (s: number): string => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.round((s - Math.floor(s)) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  };
  // SRT 不允许 \r\n 之外的换行, 折行用 \n
  const cleanText = text.replace(/\r/g, '').replace(/\n+/g, '\n').trim();
  return `${index}\n${fmtTime(startSec)} --> ${fmtTime(startSec + durationSec)}\n${cleanText}\n`;
}

/**
 * 从 shots[] 构造完整 srt 文件内容.
 *
 * @param shots  按播放顺序排好的镜头数组, 每个含 dialogue + duration
 * @returns srt 文件内容字符串, 无 dialogue 镜头会被跳过
 */
export function buildSrt(
  shots: Array<{ dialogue?: string; duration?: number }>,
): string {
  const parts: string[] = [];
  let cursor = 0;
  let index = 1;
  for (const shot of shots) {
    const dur = typeof shot.duration === 'number' && shot.duration > 0 ? shot.duration : 5;
    const dialogue = stripNonDialogueBrackets(shot.dialogue || '');
    if (dialogue) {
      parts.push(buildSrtEntry(index, cursor, dur, dialogue));
      index++;
    }
    cursor += dur;
  }
  return parts.join('\n');
}

/**
 * v12.264 音画同步:按**显式起点**构造 SRT —— 起点由 composer 的 xfade 压缩时间轴给出,
 * 不再内部纯累加 duration。根因:链式 xfade 每次转场把画面压缩 effectiveTd,若字幕仍按
 * durations 纯累加定位,则字幕相对画面/配音逐镜滞后 Σ effectiveTd(≈0.5~1s)。这里让字幕起点
 * 与配音 adelay、画面 xfade offset 同源(均来自 computeXfadeTimeline),三轨齐平不脱节。
 *
 * @param shots 按播放顺序;startSec=该镜在压缩后输出时间轴的画面起点,durSec=字幕展示时长(通常=该镜终值时长)
 * @returns srt 文件内容;无台词镜跳过。起点缺省/非法回退 0,时长缺省/非法回退 5s(与 buildSrt 一致)。
 */
export function buildSrtWithStarts(
  shots: Array<{ dialogue?: string; startSec?: number; durSec?: number }>,
): string {
  const parts: string[] = [];
  let index = 1;
  for (const shot of shots) {
    const dur = typeof shot.durSec === 'number' && shot.durSec > 0 ? shot.durSec : 5;
    const start = typeof shot.startSec === 'number' && shot.startSec >= 0 ? shot.startSec : 0;
    const dialogue = stripNonDialogueBrackets(shot.dialogue || '');
    if (dialogue) {
      parts.push(buildSrtEntry(index, start, dur, dialogue));
      index++;
    }
  }
  return parts.join('\n');
}

/**
 * 过滤"非台词"括号内容,只保留真正会被说出口的台词,供字幕烧录与 TTS 共用。
 * 剧本里的括号一律是舞台/音效/配乐/语气/动作指示(如「(无对白,只有金属撞击与走火的轰响)」
 * 「(喉间一声闷哑的吸气)」「(沉稳)」「(低哑,对自己)」),都不是出声台词 —— 一律剔除,
 * 只留角色真正说出的话,避免它们被烧进字幕或被 TTS 念出来。
 *  · 整行只有括号 → 返回 ''(该镜无台词)
 *  · 行内括号 → 删括号段,保留前后台词
 *  · 清掉括号删除后残留的行首孤立标点(如「……哪来的」→「哪来的」)
 */
export function stripNonDialogueBrackets(text: string): string {
  let t = (text || '').replace(/\r/g, '').trim();
  if (!t) return '';
  // 删除所有括号段(中/英,非嵌套)
  t = t.replace(/[（(][^（()）]*[)）]/g, '').replace(/\s{2,}/g, ' ').trim();
  // 清理括号删除后残留的行首孤立标点
  t = t.replace(/^[\s,，、:：;；…—-]+/, '').trim();
  return t;
}

/**
 * 系统找 CJK 字体路径, 让 ffmpeg subtitles filter 能用.
 * 找不到返 null, 调用方走 fallback (拼 subtitles filter 不指定 fontsdir, libass 走默认).
 *
 * 顺序(v12.233 调整 —— 开源字体优先,规避商用授权风险 🟡-27):
 *   1. env CJK_FONT_FILE 指定 (运维覆盖)
 *   2. **开源可商用**字体:项目自带 data/fonts/ → Linux 系统 Noto CJK / 文泉驿
 *   3. macOS 系统内置(PingFang 等)—— **仅最后兜底并告警**
 *
 * 为什么调顺序:PingFang 等 macOS 系统字体受 Apple EULA 约束,**把字形烧进对外分发的
 * 商用视频属于越界使用**。此前 macOS 排第一 → 本机跑出的每条商用成片都踩这条线。
 * 现在开源字体(Noto CJK / WenQuanYi,SIL OFL / Apache-2.0,明确允许商用嵌入)优先;
 * 只有一个开源字体都找不到时才退回系统字体,并打警告告诉运营者该装字体了。
 */

/** 开源可商用 CJK 字体候选(SIL OFL / Apache-2.0,允许嵌入分发)。 */
const OPEN_LICENSE_CJK_FONTS = [
  // 项目自带(docker / 自部署预装 —— 最可控)
  path.join(process.cwd(), 'data', 'fonts', 'NotoSansCJK-Regular.otf'),
  path.join(process.cwd(), 'data', 'fonts', 'cjk.ttf'),
  // Linux 常见发行版路径
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  '/usr/share/fonts/truetype/arphic/uming.ttc',
  // macOS 上用 brew/手动装的开源 CJK(Noto 与思源黑体同源,均 SIL OFL)
  '/Library/Fonts/NotoSansCJKsc-Regular.otf',
  '/Library/Fonts/SourceHanSansCN-Regular.otf',
  path.join(process.env.HOME || '', 'Library/Fonts/NotoSansCJKsc-Regular.otf'),
  path.join(process.env.HOME || '', 'Library/Fonts/SourceHanSansCN-Regular.otf'),
  path.join(process.env.HOME || '', 'Library/Fonts/SourceHanSansCN-Normal.otf'),
];

/** macOS 系统内置 CJK —— 受 Apple EULA 约束,仅兜底。 */
const SYSTEM_FALLBACK_CJK_FONTS = [
  '/System/Library/Fonts/PingFang.ttc',
  '/System/Library/Fonts/STHeiti Light.ttc',
  '/System/Library/Fonts/STHeiti Medium.ttc',
  '/System/Library/Fonts/Hiragino Sans GB.ttc',
  '/Library/Fonts/Songti.ttc',
];

let warnedSystemFont = false;

export function findCjkFont(): string | null {
  const envFont = process.env.CJK_FONT_FILE;
  if (envFont && fs.existsSync(envFont)) return envFont;

  for (const p of OPEN_LICENSE_CJK_FONTS) {
    if (p && fs.existsSync(p)) return p;
  }

  // 一个开源字体都没有 → 退回系统字体,但要让运营者知道自己踩在哪条线上
  for (const p of SYSTEM_FALLBACK_CJK_FONTS) {
    if (fs.existsSync(p)) {
      if (!warnedSystemFont) {
        warnedSystemFont = true;
        console.warn(
          `[fonts] ⚠️ 未找到开源 CJK 字体,回退系统字体 ${path.basename(p)}。` +
          '系统字体(PingFang 等)受 Apple EULA 约束,**烧进对外分发的商用视频属越界使用**。' +
          '请装 Noto Sans CJK 或放 data/fonts/NotoSansCJK-Regular.otf,亦可用 CJK_FONT_FILE 指定。',
        );
      }
      return p;
    }
  }
  return null;
}

/** v12.233:该字体是否开源可商用(供体检/合规提示判断)。 */
export function isOpenLicenseFont(fontPath: string | null): boolean {
  if (!fontPath) return false;
  if (process.env.CJK_FONT_FILE && fontPath === process.env.CJK_FONT_FILE) return true; // 运维显式指定,视为已确认
  return !SYSTEM_FALLBACK_CJK_FONTS.includes(fontPath);
}
