/**
 * BGM 自动闪避(ducking,v12.67.0)。
 *
 * 病根:成片 BGM 全程恒定音量(有配音时仅静态降到 0.2),旁白与 BGM 频段打架,人声发闷。
 * 行业标准做法 = sidechain 压缩:旁白响起的瞬间 BGM 自动压低,停顿处自然回升。
 * 本模块产 ffmpeg filter 片段(纯函数,可测):
 *   [vo]asplit=2[vo_sc][vo_mix];[music][vo_sc]sidechaincompress=...[music_ducked]
 * 真正接线在 video-composer(仅 BGM+配音同时存在时启用;BGM_DUCK_DISABLE=1 关闭)。
 */

export interface DuckingPlan {
  filters: string[];
  musicOut: string; // 压低后的 BGM 标签
  voOut: string;    // 供 amix 的配音标签(asplit 复制)
}

/** env 数值解析:非法/越界回默认(闪避参数配错不该炸合成)。 */
function envNum(raw: string | undefined, min: number, max: number, dflt: number): number {
  const v = Number(raw);
  return Number.isFinite(v) && v >= min && v <= max ? v : dflt;
}

/**
 * @param musicLabel 已就绪的 BGM 流标签(如 '[musicvol]')
 * @param voLabel    已就绪的配音流标签(如 '[vomix]' 或 '[vo0]')
 * v12.195:attack 120→20ms(旧值人声开口后 BGM 还赖 1/8 秒,首字被糊)、
 * release 600→350ms(短对白间隙 BGM 能回来但不抢)、ratio 6→4(压得自然)。
 * env BGM_DUCK_ATTACK / BGM_DUCK_RELEASE / BGM_DUCK_RATIO 可调(供不同题材试听微调)。
 */
export function buildDuckingFilters(
  musicLabel: string,
  voLabel: string,
  env: NodeJS.ProcessEnv = process.env,
): DuckingPlan {
  const attack = envNum(env.BGM_DUCK_ATTACK, 5, 500, 20);
  const release = envNum(env.BGM_DUCK_RELEASE, 50, 2000, 350);
  const ratio = envNum(env.BGM_DUCK_RATIO, 2, 20, 4);
  const filters = [
    `${voLabel}asplit=2[duck_sc][duck_vo]`,
    `${musicLabel}[duck_sc]sidechaincompress=threshold=0.02:ratio=${ratio}:attack=${attack}:release=${release}:makeup=1[duck_music]`,
  ];
  return { filters, musicOut: '[duck_music]', voOut: '[duck_vo]' };
}

/** 是否启用 ducking(纯判定,可测):必须 BGM+配音齐备,且未被 env 关闭。 */
export function shouldDuck(hasMusic: boolean, voCount: number, env: NodeJS.ProcessEnv = process.env): boolean {
  return hasMusic && voCount > 0 && env.BGM_DUCK_DISABLE !== '1';
}

/**
 * v12.110.0 响度归一(纯函数):平台标准 -14 LUFS(抖音/小红书/YouTube 通行),
 * true peak -1.5 dBTP 防削波。成片响度忽大忽小会被平台二次压缩(音质损)或听感突兀。
 * 挂在最终音频标签后;AUDIO_LOUDNORM_DISABLE=1 关。
 */
export function buildLoudnormFilter(inLabel: string, outLabel: string = '[anorm]'): string {
  return `${inLabel}loudnorm=I=-14:TP=-1.5:LRA=11[${outLabel.replace(/^\[|\]$/g, '')}]`;
}

export function shouldLoudnorm(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AUDIO_LOUDNORM_DISABLE !== '1';
}

/**
 * v12.206 EBU R128 双遍响度归一(纯函数三件套 + opt-in 后处理)。
 *
 * 单遍 loudnorm 是「估算」增益,含 TTS+BGM+打击音的成片误差可达 ±2 LUFS(平台会二次压缩伤音质)。
 * 双遍:①第一遍 print_format=json 测出真实 measured_I/TP/LRA/thresh;②第二遍 linear=true 喂测量值,
 * 做真正的 EBU R128 线性归一(误差 <0.5 LUFS)。侵入主合成代价大 → 做成成片后 opt-in 后处理
 * (AUDIO_LOUDNORM_2PASS=1),纯函数便于单测。
 */

/** 第一遍探测滤镜:输出带 JSON 统计(ffmpeg 走这个 filter + -f null,stderr 尾部含 JSON)。 */
export function buildLoudnormMeasureFilter(): string {
  return 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json';
}

/** 从第一遍 ffmpeg stderr 解析 measured 值;拿不全 → null(调用方回退单遍)。 */
export function parseLoudnormJson(stderr: string): { input_i: string; input_tp: string; input_lra: string; input_thresh: string } | null {
  try {
    // ffmpeg 把 JSON 打在 stderr 末尾的 { ... } 块
    const m = stderr.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]);
    const need = ['input_i', 'input_tp', 'input_lra', 'input_thresh'];
    if (need.some((k) => j[k] == null || !Number.isFinite(Number(j[k])))) return null;
    return { input_i: String(j.input_i), input_tp: String(j.input_tp), input_lra: String(j.input_lra), input_thresh: String(j.input_thresh) };
  } catch { return null; }
}

/** 第二遍应用滤镜:喂第一遍测量值做线性精确归一。 */
export function buildLoudnormApplyFilter(m: { input_i: string; input_tp: string; input_lra: string; input_thresh: string }): string {
  return `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:linear=true`;
}

export function shouldTwoPassLoudnorm(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AUDIO_LOUDNORM_2PASS === '1';
}
