/**
 * 分镜运镜 → 可灵 camera_control 映射(v12.201.0,纯函数)。
 *
 * 零成本探测结论(2026-07):camera_control 仅 **kling-v1-5 + pro mode + 5s** 可用
 * (v3 明确 "Camera control is not supported by the current model")。故这是「预备态」:
 * 默认不动 v3 主路径;仅当运营者显式设 env KLING_CAMERA_MODEL=kling-v1-5 时,带运镜的镜
 * 降级到 v1-5 pro 走 camera_control(以画质换导演级运镜控制,诚实标注)。
 *
 * 官方 config 为 6 轴单选(horizontal/vertical/pan/tilt/roll/zoom,值 -10~10);
 * 静止/无对应运镜 → null(不注入,保原生成)。
 */

export interface KlingCameraControl {
  type: 'simple';
  config: Partial<{
    horizontal: number; vertical: number; pan: number; tilt: number; roll: number; zoom: number;
  }>;
}

/** 运镜 preset id(CAMERA_LANGUAGE_PRESETS)→ camera_control;无法表达 → null。 */
export function mapCameraMovement(movement: string | null | undefined): KlingCameraControl | null {
  const m = (movement || '').trim().toLowerCase();
  if (!m) return null;
  const MAP: Record<string, KlingCameraControl['config']> = {
    'push-in': { zoom: 5 },
    'crash-zoom': { zoom: 9 },
    'pull-out': { zoom: -5 },
    'crane-up': { vertical: 6 },
    'tilt-down': { tilt: -5 },
    'orbit': { pan: 8 },
    'arc': { pan: 4 },
    'whip-pan': { horizontal: 8 },
    'tracking': { horizontal: 5 },
    // locked-tripod / handheld / dolly-zoom:camera_control 无对应 → null(不注入)
  };
  const cfg = MAP[m];
  return cfg ? { type: 'simple', config: cfg } : null;
}

/** 该 model+mode 是否允许 camera_control(探测:仅 v1-5 + pro)。 */
export function cameraControlSupported(model: string | null | undefined, mode: string | null | undefined): boolean {
  return /kling-v1-5/.test(model || '') && (mode || '') === 'pro';
}
