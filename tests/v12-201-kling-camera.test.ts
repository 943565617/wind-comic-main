/**
 * v12.201 — 运镜 camera_control 映射(纯函数)+ 支持矩阵 + service/orchestrator 接线锁。
 */
import { describe, it, expect } from 'vitest';
import { mapCameraMovement, cameraControlSupported } from '@/lib/kling-camera';
import fs from 'fs';

describe('v12.201 · 运镜 camera_control', () => {
  it('映射:推近/急推→zoom,拉远→负zoom,升镜→vertical,俯拍→tilt,环绕→pan', () => {
    expect(mapCameraMovement('push-in')).toEqual({ type: 'simple', config: { zoom: 5 } });
    expect(mapCameraMovement('crash-zoom')?.config.zoom).toBe(9);
    expect(mapCameraMovement('pull-out')?.config.zoom).toBe(-5);
    expect(mapCameraMovement('crane-up')?.config.vertical).toBe(6);
    expect(mapCameraMovement('tilt-down')?.config.tilt).toBe(-5);
    expect(mapCameraMovement('orbit')?.config.pan).toBe(8);
  });
  it('无对应/静止/空 → null(不注入,保原生成)', () => {
    expect(mapCameraMovement('locked-tripod')).toBeNull();
    expect(mapCameraMovement('handheld')).toBeNull();
    expect(mapCameraMovement('dolly-zoom')).toBeNull();
    expect(mapCameraMovement('')).toBeNull();
    expect(mapCameraMovement(null)).toBeNull();
  });
  it('支持矩阵:仅 v1-5+pro(探测结论)', () => {
    expect(cameraControlSupported('kling-v1-5', 'pro')).toBe(true);
    expect(cameraControlSupported('kling-v1-5', 'std')).toBe(false);
    expect(cameraControlSupported('kling-v3', 'pro')).toBe(false);
    expect(cameraControlSupported('kling-v1-6', 'pro')).toBe(false);
  });
  it('接线锁:service 仅 supported 才注入 + orchestrator env 门控', () => {
    const svc = fs.readFileSync('services/kling.service.ts', 'utf-8');
    expect(svc).toContain('cameraControlSupported(model, body.mode)');
    expect(svc).toContain('body.camera_control = options.cameraControl');
    const orch = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    expect(orch).toContain('KLING_CAMERA_MODEL');
    expect(orch).toContain('mapCameraMovement');
  });
});
