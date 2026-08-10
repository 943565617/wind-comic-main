/**
 * 分镜 schema 枚举化(v12.142.0,P0-2,对标阅文结构化分镜)。
 *
 * 病根:cinema spec(writer-enhance)对 shotSize/cameraMovement 只有 **prompt 软约束**,
 * LLM 输出仍会漂(「slow push in」「推近」「dolly in」「Dolly-In」各种形态),漂移词被
 * 原样直通拼进视频 prompt → 引擎理解不稳、跨镜风格漂。本模块提供**硬规范化**:
 * 枚举表(与 writer prompt 中的约束一字一致)+ 别名/中文/自由文本 → 枚举的纯函数。
 * 归一不了 → null(调用方保留原文,诚实降级、零回归)。
 */

/** 运镜枚举(Runway 20 动词,与 writer-enhance prompt 约束一致)。 */
export const CAMERA_MOVEMENT_ENUM = [
  'static', 'dolly-in', 'dolly-out', 'truck-left', 'truck-right', 'crane-up', 'crane-down',
  'pedestal-up', 'pedestal-down', 'arc', 'orbit', 'pan-left', 'pan-right', 'tilt-up', 'tilt-down',
  'zoom-in', 'zoom-out', 'handheld', 'push-in', 'pull-out',
] as const;
export type CameraMovement = typeof CAMERA_MOVEMENT_ENUM[number];

/** 景别枚举(与 writer-enhance prompt 约束一致)。 */
export const SHOT_SIZE_ENUM = ['ECU', 'CU', 'MCU', 'MS', 'MLS', 'LS', 'ELS', 'wide', 'insert'] as const;
export type ShotSize = typeof SHOT_SIZE_ENUM[number];

// 别名/中文/自由描述 → 枚举(小写比对;长 key 优先匹配防子串误归)
const MOVEMENT_ALIASES: Array<[RegExp, CameraMovement]> = [
  [/dolly[\s-]?zoom|vertigo/i, 'push-in'],          // dolly-zoom 近似归 push-in(枚举无此项)
  [/push[\s-]?in|推近|推镜|缓推|slow push/i, 'push-in'],
  [/pull[\s-]?out|拉远|拉镜|后拉/i, 'pull-out'],
  [/dolly[\s-]?in/i, 'dolly-in'],
  [/dolly[\s-]?out/i, 'dolly-out'],
  [/truck[\s-]?left|左移/i, 'truck-left'],
  [/truck[\s-]?right|右移/i, 'truck-right'],
  [/crane[\s-]?up|升镜|升降.*上|上升/i, 'crane-up'],
  [/crane[\s-]?down|降镜|下降/i, 'crane-down'],
  [/pedestal[\s-]?up/i, 'pedestal-up'],
  [/pedestal[\s-]?down/i, 'pedestal-down'],
  [/orbit|环绕|绕拍/i, 'orbit'],
  [/\barc\b|弧线|弧形/i, 'arc'],
  [/pan[\s-]?left|左摇/i, 'pan-left'],
  [/pan[\s-]?right|右摇|甩镜|whip[\s-]?pan/i, 'pan-right'],
  [/tilt[\s-]?up|上仰|仰拍.*摇/i, 'tilt-up'],
  [/tilt[\s-]?down|俯摇|下俯/i, 'tilt-down'],
  [/zoom[\s-]?in|变焦推|急推|crash[\s-]?zoom/i, 'zoom-in'],
  [/zoom[\s-]?out|变焦拉/i, 'zoom-out'],
  [/handheld|手持|肩扛|晃动/i, 'handheld'],
  [/static|locked|tripod|固定|定机位|静止/i, 'static'],
  [/track(ing)?|跟拍|跟随/i, 'truck-right'],         // 通用 tracking 近似归 truck
];

const SHOT_SIZE_ALIASES: Array<[RegExp, ShotSize]> = [
  [/extreme[\s-]?close|大特写|极特写|\becu\b/i, 'ECU'],
  [/medium[\s-]?close|中近景|\bmcu\b/i, 'MCU'],
  [/close[\s-]?up|特写|近景|\bcu\b/i, 'CU'],
  [/medium[\s-]?long|中远景|\bmls\b/i, 'MLS'],
  [/medium|中景|\bms\b/i, 'MS'],
  [/extreme[\s-]?long|大远景|\bels\b/i, 'ELS'],
  [/establishing|定场|全景|wide|广角全|\bws\b/i, 'wide'],
  [/long[\s-]?shot|远景|\bls\b/i, 'LS'],
  [/insert|插入|细节镜/i, 'insert'],
];

/** 运镜自由文本 → 枚举;归一不了 → null(保留原文)。 */
export function normalizeCameraMovement(text: string | null | undefined): CameraMovement | null {
  const t = (text || '').trim();
  if (!t) return null;
  const exact = CAMERA_MOVEMENT_ENUM.find((e) => e.toLowerCase() === t.toLowerCase());
  if (exact) return exact;
  for (const [re, v] of MOVEMENT_ALIASES) if (re.test(t)) return v;
  return null;
}

/** 景别自由文本 → 枚举;归一不了 → null。 */
export function normalizeShotSize(text: string | null | undefined): ShotSize | null {
  const t = (text || '').trim();
  if (!t) return null;
  const exact = SHOT_SIZE_ENUM.find((e) => e.toLowerCase() === t.toLowerCase());
  if (exact) return exact;
  for (const [re, v] of SHOT_SIZE_ALIASES) if (re.test(t)) return v;
  return null;
}

/** 拼 prompt 用:规范化到枚举则用枚举(连字符转空格),否则原文透传(诚实降级)。 */
export function canonicalMovementForPrompt(text: string | null | undefined): string {
  const norm = normalizeCameraMovement(text);
  return norm ? norm.replace(/-/g, ' ') : (text || '').trim();
}
