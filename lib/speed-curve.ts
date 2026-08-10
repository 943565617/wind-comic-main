/**
 * 速度曲线(v12.185.0)—— 六档固定变速 → 关键帧曲线(高潮镜 S 形慢放)。
 *
 * 数学:分段常速。输出 PTS = 累计(段时长/段速度)。ffmpeg setpts 用嵌套 if 按输入
 * 时间 T 分段重映射;音频 atempo 不支持表达式 → 用「时长加权平均速度」近似(诚实注释,
 * 对 2-3 段的短镜听感偏差 <5%)。UI 关键帧拖拽控件留后续(数据模型已就绪)。
 */

export interface SpeedKeyframe { t: number; speed: number }  // t: 输入时间秒(段起点), speed: 该段倍速

/** 规范化:按 t 升序、首段补 t=0、速度 clamp 0.25-4。 */
export function normalizeCurve(curve: SpeedKeyframe[]): SpeedKeyframe[] {
  const cleaned = (curve || [])
    .filter((k) => Number.isFinite(k.t) && Number.isFinite(k.speed))
    .map((k) => ({ t: Math.max(0, k.t), speed: Math.min(4, Math.max(0.25, k.speed)) }))
    .sort((a, b) => a.t - b.t);
  if (cleaned.length === 0) return [];
  if (cleaned[0].t > 0) cleaned.unshift({ t: 0, speed: cleaned[0].speed });
  return cleaned;
}

/** 曲线 → ffmpeg setpts 表达式(嵌套 if;段 i 输出时刻 = base_i + (T - t_i)/s_i)。 */
export function speedCurveToSetpts(curve: SpeedKeyframe[], clipDurSec: number): string | null {
  const ks = normalizeCurve(curve);
  if (ks.length === 0) return null;
  if (ks.length === 1) return `PTS/${ks[0].speed.toFixed(3)}`;
  // 预计算每段输出起点(秒)
  const bases: number[] = [0];
  for (let i = 1; i < ks.length; i++) {
    const segDur = ks[i].t - ks[i - 1].t;
    bases.push(bases[i - 1] + segDur / ks[i - 1].speed);
  }
  // 从最后一段向前折叠嵌套 if
  let expr = `(${bases[ks.length - 1].toFixed(4)}+(T-${ks[ks.length - 1].t.toFixed(3)})/${ks[ks.length - 1].speed.toFixed(3)})/TB`;
  for (let i = ks.length - 2; i >= 0; i--) {
    const inner = `(${bases[i].toFixed(4)}+(T-${ks[i].t.toFixed(3)})/${ks[i].speed.toFixed(3)})/TB`;
    expr = `if(lt(T\\,${ks[i + 1].t.toFixed(3)})\\,${inner}\\,${expr})`;
  }
  return expr;
}

/** 曲线的时长加权平均速度(音频 atempo 近似 + 输出时长估算用)。 */
export function averageSpeed(curve: SpeedKeyframe[], clipDurSec: number): number {
  const ks = normalizeCurve(curve);
  if (ks.length === 0 || clipDurSec <= 0) return 1;
  let outDur = 0;
  for (let i = 0; i < ks.length; i++) {
    const end = i + 1 < ks.length ? Math.min(ks[i + 1].t, clipDurSec) : clipDurSec;
    const seg = Math.max(0, end - ks[i].t);
    outDur += seg / ks[i].speed;
  }
  return outDur > 0 ? clipDurSec / outDur : 1;
}

/** 高潮镜 S 形慢放预设:正常进 → 中段慢放强调 → 回速收尾。 */
export function climaxRamp(clipDurSec: number, slowSpeed = 0.6): SpeedKeyframe[] {
  if (clipDurSec < 2.4) return []; // 太短不折腾
  const a = clipDurSec * 0.3, b = clipDurSec * 0.75;
  return [
    { t: 0, speed: 1 },
    { t: Number(a.toFixed(2)), speed: slowSpeed },
    { t: Number(b.toFixed(2)), speed: 1.05 },
  ];
}
