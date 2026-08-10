/**
 * 成片基础调色(v12.200.0,纯函数 / 纯 ffmpeg eq,零外部成本)。
 *
 * 病根:多引擎拼接(Kling 偏暖 / MiniMax 偏冷 / Veo 中性)时全片色调跳变,观感「像不同
 * 摄影师拍的」。业界最低成本对策:统一挂一层轻量 eq(对比+饱和+gamma)把成片拉到同一
 * 基调,并按题材微偏(悬疑压 gamma 更沉、燃向提饱和、甜宠暖白)。
 * 强度保守(避免过曝/塑料感);COLOR_GRADE_DISABLE=1 整层关闭。
 */

export type GradeGenre = 'suspense' | 'sweet' | 'epic' | 'default';

/** 题材关键词 → 调色档(与题材镜头包 v12.193 同源直觉,松匹配)。 */
export function detectGradeGenre(hint?: string | null): GradeGenre {
  const h = (hint || '').toLowerCase();
  if (/悬疑|惊悚|noir|thriller|suspense|恐怖|犯罪/.test(h)) return 'suspense';
  if (/甜宠|恋爱|romance|sweet|治愈|温情/.test(h)) return 'sweet';
  if (/燃|史诗|epic|热血|战斗|action/.test(h)) return 'epic';
  return 'default';
}

/**
 * 生成 eq 滤镜片段(不含前后逗号/标签,调用方自行拼接)。
 * @param genre 题材档;不传 = default 通用补偿
 * @param env   注入 env(COLOR_GRADE_DISABLE=1 → 返回 null,调用方跳过)
 */
export function buildColorGradeFilter(
  genre: GradeGenre = 'default',
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env.COLOR_GRADE_DISABLE === '1') return null;
  // [对比, 饱和, gamma];gamma<1 提亮中间调、>1 压沉
  const P: Record<GradeGenre, { contrast: number; saturation: number; gamma: number }> = {
    default: { contrast: 1.05, saturation: 1.12, gamma: 0.98 },
    suspense: { contrast: 1.08, saturation: 1.02, gamma: 1.06 }, // 低饱和 + 压沉,冷峻
    sweet: { contrast: 1.03, saturation: 1.15, gamma: 0.94 },    // 提亮 + 暖饱和,通透
    epic: { contrast: 1.10, saturation: 1.20, gamma: 0.97 },     // 高对比高饱和,浓烈
  };
  const p = P[genre] || P.default;
  const eq = `eq=contrast=${p.contrast}:saturation=${p.saturation}:gamma=${p.gamma}`;
  // v12.205:轻晕影聚焦视线到画面中心(电影感),eval=init 只算一次不耗性能;VIGNETTE_DISABLE=1 关
  return env.VIGNETTE_DISABLE === '1' ? eq : `${eq},vignette=PI/5:eval=init`;
}
