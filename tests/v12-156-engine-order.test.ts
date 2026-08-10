/**
 * v12.156 — 引擎链序可配置:resolveEngineOrder 纯函数 + 两处接线锁。
 */
import { describe, it, expect } from 'vitest';
import { resolveEngineOrder, parseEngineOrderEnv } from '@/lib/engine-order';
import fs from 'fs';

describe('v12.156 · resolveEngineOrder', () => {
  const all: Array<'veo' | 'minimax' | 'kling'> = ['veo', 'minimax', 'kling'];
  it('显式 provider 打头;env 序次之;默认 Veo 打头', () => {
    expect(resolveEngineOrder('kling', all)).toEqual(['kling', 'veo', 'minimax']);
    expect(resolveEngineOrder('minimax', all)).toEqual(['minimax', 'veo', 'kling']);
    expect(resolveEngineOrder(undefined, all, ['kling', 'minimax', 'veo'])).toEqual(['kling', 'minimax', 'veo']);
    expect(resolveEngineOrder(undefined, all)).toEqual(['veo', 'minimax', 'kling']);
  });
  it('显式 provider + env:provider 打头,其余按 env 序', () => {
    expect(resolveEngineOrder('veo', all, ['kling', 'minimax', 'veo'])).toEqual(['veo', 'kling', 'minimax']);
  });
  it("v12.157:'keling'/'veo3.1' 别名归一(创作页可灵选项此前被静默忽略)", () => {
    expect(resolveEngineOrder('keling', all)).toEqual(['kling', 'veo', 'minimax']);
    expect(resolveEngineOrder('veo3.1', all, ['kling', 'minimax', 'veo'])).toEqual(['veo', 'kling', 'minimax']);
  });
  it('不可用引擎剔除;provider 不可用退 env/默认;未知名忽略', () => {
    expect(resolveEngineOrder('kling', ['veo', 'minimax'])).toEqual(['veo', 'minimax']);
    expect(resolveEngineOrder('sora' as any, all, ['minimax'])).toEqual(['minimax', 'veo', 'kling']);
    expect(parseEngineOrderEnv('kling, MINIMAX, bogus,veo')).toEqual(['kling', 'minimax', 'veo']);
    expect(resolveEngineOrder(undefined, [])).toEqual([]);
  });
  it('v12.178:对白镜偏好 —— 有台词+env 设定才重排;偏好不可用不动', async () => {
    const { resolveEngineOrderForShot } = await import('@/lib/engine-order');
    const base = ['veo', 'minimax', 'kling'] as any[];
    expect(resolveEngineOrderForShot(base as any, { dialogue: '你好世界' }, { DIALOGUE_ENGINE: 'kling' })).toEqual(['kling', 'veo', 'minimax']);
    expect(resolveEngineOrderForShot(base as any, { dialogue: '' }, { DIALOGUE_ENGINE: 'kling' })).toEqual(base);
    expect(resolveEngineOrderForShot(base as any, { dialogue: '你好' }, {})).toEqual(base);
    expect(resolveEngineOrderForShot(['veo'] as any, { dialogue: '你好' }, { DIALOGUE_ENGINE: 'kling' })).toEqual(['veo']);
  });
  it('接线锁:主管线与 regenerateShot 均走 resolveEngineOrder + env', () => {
    const src = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    expect((src.match(/resolveEngineOrder\(/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(src).toContain('resolveEngineOrderForShot(engineOrder');
    expect(src).toContain('parseEngineOrderEnv(process.env.VIDEO_ENGINE_ORDER)');
  });
});
