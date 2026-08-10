/**
 * v12.142 — P0-2 分镜 schema 枚举化:漂移词硬规范化(运镜/景别),归一不了原文透传。
 */
import { describe, it, expect } from 'vitest';
import { normalizeCameraMovement, normalizeShotSize, canonicalMovementForPrompt, CAMERA_MOVEMENT_ENUM, SHOT_SIZE_ENUM } from '@/lib/shot-enums';
import { renderVeoProsePrefix } from '@/lib/writer-enhance';

describe('v12.142 · 运镜规范化', () => {
  it('精确/大小写/别名/中文/自由描述全部归枚举', () => {
    expect(normalizeCameraMovement('push-in')).toBe('push-in');
    expect(normalizeCameraMovement('Push-In')).toBe('push-in');
    expect(normalizeCameraMovement('slow push in')).toBe('push-in');
    expect(normalizeCameraMovement('推近')).toBe('push-in');
    expect(normalizeCameraMovement('缓慢推近(dolly-in),从巷口全景推至门面')).toBe('push-in'); // 推近先命中
    expect(normalizeCameraMovement('固定机位')).toBe('static');
    expect(normalizeCameraMovement('手持微晃')).toBe('handheld');
    expect(normalizeCameraMovement('环绕推移(orbit)')).toBe('orbit');
    expect(normalizeCameraMovement('whip pan')).toBe('pan-right');
    expect(normalizeCameraMovement('crash zoom')).toBe('zoom-in');
  });
  it('归一不了 → null;canonical 原文透传', () => {
    expect(normalizeCameraMovement('镜头如流水般诗意游走')).toBeNull();
    expect(canonicalMovementForPrompt('镜头如流水般诗意游走')).toBe('镜头如流水般诗意游走');
    expect(canonicalMovementForPrompt('dolly-in')).toBe('dolly in');
    expect(canonicalMovementForPrompt('')).toBe('');
  });
  it('枚举表完整(20 运镜 / 9 景别,与 writer prompt 约束一致)', () => {
    expect(CAMERA_MOVEMENT_ENUM.length).toBe(20);
    expect(SHOT_SIZE_ENUM.length).toBe(9);
  });
});

describe('v12.142 · 景别规范化', () => {
  it('缩写/全称/中文全归枚举', () => {
    expect(normalizeShotSize('ecu')).toBe('ECU');
    expect(normalizeShotSize('close-up')).toBe('CU');
    expect(normalizeShotSize('特写')).toBe('CU');
    expect(normalizeShotSize('中近景')).toBe('MCU');
    expect(normalizeShotSize('大远景')).toBe('ELS');
    expect(normalizeShotSize('establishing shot')).toBe('wide');
    expect(normalizeShotSize('花里胡哨景别')).toBeNull();
  });
});

describe('v12.142 · renderVeoProsePrefix 消费端接线', () => {
  it('漂移词进 prompt 前被归一;归一不了原样保留(零回归)', () => {
    expect(renderVeoProsePrefix({ cameraMovement: '推近', shotSize: '特写' })).toContain('push in');
    expect(renderVeoProsePrefix({ cameraMovement: '推近', shotSize: '特写' })).toContain('CU');
    expect(renderVeoProsePrefix({ cameraMovement: 'dolly-in', lens: '85mm', shotSize: 'MCU' })).toContain('dolly in on 85mm lens');
    expect(renderVeoProsePrefix({ cameraMovement: '诗意游走' })).toContain('诗意游走'); // 透传
  });
});
