/**
 * 情绪节拍 → 运镜自动标注(v12.146.0,P1-④,对标专业分镜师按叙事功能选运镜)。
 *
 * 病根:Writer 偶尔漏填 cameraMovement(schema 软约束),漏填的镜没有镜头语言设计,
 * 视频引擎自由发挥 → 运镜与情绪脱节(高燃戏静止机位/抒情戏乱晃)。
 * 本模块按镜头已有的情绪信号(emotionTemperature / beats.mood / beatFunction / 景别)
 * 推导电影学惯例运镜,**只补缺失的镜**:
 *   - 用户在创作页选了全局运镜默认 → 完全不介入(显式选择优先)
 *   - shot 已有 cameraMovement(哪怕归一失败的自由文本)→ 保留原文(尊重 Writer 设计)
 * 纯函数、零 LLM 调用、零成本。
 */
import { normalizeShotSize, type CameraMovement } from './shot-enums';

export interface EmotionCameraShot {
  shotNumber?: number;
  cameraMovement?: string | null;
  emotionTemperature?: number;
  beatFunction?: string;
  shotSize?: string;
  visualPrompt?: string;
  beats?: Array<{ mood?: string; action?: string }>;
}

export interface CameraSuggestion {
  move: CameraMovement;
  reason: string;
}

// 强信号关键词(mood/action/visualPrompt)→ 运镜;长语义优先于温度规则
const KEYWORD_RULES: Array<[RegExp, CameraMovement, string]> = [
  [/追逐|奔跑|打斗|搏斗|逃亡|逃跑|冲刺|chase|fight|run/i, 'handheld', '动作戏手持增张力'],
  [/揭示|真相|发现|反转|震惊|reveal|twist/i, 'zoom-in', '揭示时刻急推聚焦'],
  [/离别|失落|孤独|远去|告别|绝望|farewell|lonely/i, 'pull-out', '情绪抽离拉远留白'],
  [/梦境|回忆|眩晕|恍惚|dream|memory|flashback/i, 'orbit', '环绕营造恍惚感'],
];

/**
 * 单镜建议:按 钩子 > 关键词 > 情绪温度 > 景别惯例 推导;无把握 → null(不标注)。
 */
export function suggestCameraMove(shot: EmotionCameraShot): CameraSuggestion | null {
  // ① 开场钩子:推近抓注意力(writer-enhance 本就要求第 1 镜 hook + 强情绪)
  if (shot.beatFunction === 'hook') return { move: 'push-in', reason: '开场钩子推近抓注意力' };

  // ② 强语义关键词(mood 串 + 动作描述)
  const text = [
    ...(shot.beats || []).map((b) => `${b.mood || ''} ${b.action || ''}`),
    shot.visualPrompt || '',
  ].join(' ');
  for (const [re, move, reason] of KEYWORD_RULES) if (re.test(text)) return { move, reason };

  // ③ 情绪温度(writer-enhance 约定:负=紧张压迫,正=昂扬)
  const t = shot.emotionTemperature;
  if (typeof t === 'number') {
    if (t <= -7) return { move: 'handheld', reason: `极度紧张(${t})手持晃动` };
    if (t <= -4) return { move: 'push-in', reason: `压迫感(${t})缓推逼近` };
    if (t >= 7) return { move: 'orbit', reason: `高燃(${t})环绕增能量` };
    if (t >= 4) return { move: 'crane-up', reason: `情绪上扬(${t})升镜开阔` };
  }

  // ④ 景别惯例:定场缓推入戏,特写静止让表情说话(先过 v12.142 归一,中文「特写/全景」也命中)
  const size = normalizeShotSize(shot.shotSize) || (shot.shotSize || '').toUpperCase();
  if (/^(wide|ELS|LS|MLS)$/i.test(size)) return { move: 'dolly-in', reason: '定场景别缓推入戏' };
  if (/^(ECU|CU|MCU)$/i.test(size)) return { move: 'static', reason: '特写静止让表情说话' };

  return null;
}

/**
 * 批量标注:只给 **cameraMovement 为空** 的镜就地补运镜。
 * 返回人读备注(「S3 压迫感(-5)缓推逼近→push-in」),空数组 = 无镜需要补。
 */
export function annotateCameraByEmotion(shots: EmotionCameraShot[]): string[] {
  const notes: string[] = [];
  for (const shot of shots || []) {
    if ((shot.cameraMovement || '').trim()) continue; // Writer 已设计 → 尊重原文
    const s = suggestCameraMove(shot);
    if (!s) continue;
    shot.cameraMovement = s.move;
    notes.push(`S${shot.shotNumber ?? '?'} ${s.reason}→${s.move}`);
  }
  return notes;
}

/**
 * 运镜 → Ken Burns 方向(v12.151):animatic 降级时静帧推拉方向跟随该镜运镜设计,
 * 而不是机械轮换 —— 引擎全挂时降级片也保留镜头语言。归一不了 → null(调用方轮换兜底)。
 */
export function movementToKenBurns(movement: string | null | undefined): 'in' | 'out' | 'pan' | null {
  const m = (movement || '').toLowerCase();
  if (!m.trim()) return null;
  if (/push|dolly[\s-]?in|zoom[\s-]?in|crane|pedestal|推|急推|升/.test(m)) return 'in';
  if (/pull|dolly[\s-]?out|zoom[\s-]?out|拉远|后拉/.test(m)) return 'out';
  if (/pan|truck|orbit|arc|handheld|whip|摇|移|环绕|跟拍/.test(m)) return 'pan';
  if (/static|locked|固定|静止/.test(m)) return 'in'; // 纯静帧太死,static 给最轻的缓推
  return null;
}
