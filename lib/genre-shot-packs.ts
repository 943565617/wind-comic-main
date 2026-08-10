/**
 * 题材镜头包(v12.193.0,对标 Miora Skills / genre shot-pack)。
 *
 * ad-factory 模式泛化:按题材一键注入「运镜默认 + 剪辑风格 + BGM 风格词」组合拳。
 * 只在用户**未显式选择**对应项时注入(显式选择永远优先,与情绪运镜同哲学);
 * 检测按 idea 关键词(纯函数),命中透出 agentTalk。
 */

export interface GenreShotPack {
  id: string;
  label: string;
  match: RegExp;
  cameraDefault: string;   // 与创作页 cameraDefault preset id 对齐
  editStyle: string;       // 一句话剪辑风格(setEditStyle 语义)
  bgmStyleHint: string;    // 拼进 BGM prompt 的风格词
}

export const GENRE_SHOT_PACKS: GenreShotPack[] = [
  {
    id: 'suspense', label: '悬疑',
    match: /悬疑|谜团|失踪|凶手|真相|惊悚|诡异|悬案|侦探|suspense|thriller|mystery/i,
    cameraDefault: 'slow-push',
    editStyle: '悬疑压迫感:慢推特写,硬切留白,信息一点点给',
    bgmStyleHint: 'dark ambient tension, low drone, sparse piano',
  },
  {
    id: 'sweet', label: '甜宠',
    match: /甜宠|恋爱|心动|暗恋|告白|情侣|撒糖|甜蜜|romance|crush|sweet love/i,
    cameraDefault: 'orbit',
    editStyle: '甜宠轻快:环绕柔光,节奏明快,反应特写多给',
    bgmStyleHint: 'warm acoustic pop, light strings, heartbeat sweetness',
  },
  {
    id: 'costume', label: '古装',
    match: /古装|王朝|皇帝|将军|江湖|武侠|宫廷|仙侠|朝堂|大侠|ancient china|wuxia|dynasty/i,
    cameraDefault: 'crane',
    editStyle: '古装大气:升降大景别开合,转场沉稳,留足呼吸',
    bgmStyleHint: 'chinese orchestral, guzheng and dizi, epic historical',
  },
];

/** idea → 命中的镜头包;不命中 null(不强塞)。 */
export function detectShotPack(idea: string | null | undefined): GenreShotPack | null {
  const t = (idea || '').slice(0, 500);
  if (!t) return null;
  for (const p of GENRE_SHOT_PACKS) if (p.match.test(t)) return p;
  return null;
}
