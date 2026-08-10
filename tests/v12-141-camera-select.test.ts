/**
 * v12.141 — P0-1 每镜运镜选择器:解析纯函数 + 两条重生路由接线锁。
 */
import { describe, it, expect } from 'vitest';
import { resolveCameraMovementPrompt, CAMERA_LANGUAGE_PRESETS, getCameraPreset } from '@/lib/prompt-templates';
import fs from 'fs';

describe('v12.141 · 运镜解析', () => {
  it('preset id → 专业指令;自由文本 → Camera: 前缀;空/auto → 空串', () => {
    expect(resolveCameraMovementPrompt('push-in')).toBe(getCameraPreset('push-in')!.prompt);
    expect(resolveCameraMovementPrompt('绕着主角快速旋转')).toBe('Camera: 绕着主角快速旋转.');
    expect(resolveCameraMovementPrompt('')).toBe('');
    expect(resolveCameraMovementPrompt('auto')).toBe('');
    expect(resolveCameraMovementPrompt(null)).toBe('');
  });
  it('12 预设完整可枚举(UI 下拉数据源)', () => {
    expect(CAMERA_LANGUAGE_PRESETS.length).toBe(12);
    expect(CAMERA_LANGUAGE_PRESETS.every((p) => p.id && p.label && p.prompt.startsWith('Camera:'))).toBe(true);
  });
  it('接线锁:两条重生路由 + video-node 均已贯通 cameraMovement', () => {
    for (const p of ['app/api/regenerate-shot/route.ts', 'app/api/projects/[id]/regenerate-shot/route.ts']) {
      const src = fs.readFileSync(p, 'utf-8');
      expect(src).toContain('resolveCameraMovementPrompt');
      expect(src).toContain('cameraMovement');
    }
    const ui = fs.readFileSync('components/nodes/video-node.tsx', 'utf-8');
    expect(ui).toContain('CAMERA_LANGUAGE_PRESETS');
    expect(ui).toContain('cameraMovement: shotCamera[shotNumber]');
  });
});
