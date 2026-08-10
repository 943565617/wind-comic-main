/**
 * v12.260 — 草图 ControlNet 硬锁(迭代待办③)。
 * 草图锁从 IP-Adapter 软参考升级 Canny ControlNet 刚性空间约束。
 * 注:需自托管 ComfyUI + comfyui_controlnet_aux + canny 模型,无法本地 live 验证 —— 此处测工作流图结构 + 门控 + 接线。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { buildControlNetWorkflow, hasComfyUIControlNet, comfyControlNetModel } from '@/services/comfyui.service';

describe('v12.260 buildControlNetWorkflow(工作流图结构)', () => {
  const wf = buildControlNetWorkflow('a hero on a cliff', {
    controlFilename: 'ctrl_sketch_1.png', controlNetModel: 'control_canny_xl.safetensors', seed: 42, width: 1024, height: 1024,
  }).prompt;

  it('含 Canny 预处理 + ControlNetLoader + ControlNetApplyAdvanced', () => {
    const types = Object.values(wf).map((n: any) => n.class_type);
    expect(types).toContain('CannyEdgePreprocessor');
    expect(types).toContain('ControlNetLoader');
    expect(types).toContain('ControlNetApplyAdvanced');
  });
  it('控制图 → Canny → ControlNet 链路正确', () => {
    expect(wf['20'].inputs.image).toBe('ctrl_sketch_1.png');           // LoadImage 用草图
    expect(wf['21'].inputs.image).toEqual(['20', 0]);                  // Canny 吃 LoadImage
    expect(wf['22'].inputs.control_net_name).toBe('control_canny_xl.safetensors');
    expect(wf['23'].inputs.image).toEqual(['21', 0]);                  // ControlNet 用 Canny 边缘
    expect(wf['23'].inputs.control_net).toEqual(['22', 0]);
  });
  it('KSampler 用 ControlNet 硬约束后的正/负条件(而非裸 CLIP)', () => {
    expect(wf['6'].inputs.positive).toEqual(['23', 0]);
    expect(wf['6'].inputs.negative).toEqual(['23', 1]);
    expect(wf['6'].inputs.seed).toBe(42); // 传入 seed → 确定性
  });
});

describe('v12.260 门控 hasComfyUIControlNet', () => {
  it('默认关(未配 COMFYUI_CONTROLNET_MODEL)', () => {
    expect(comfyControlNetModel()).toBeNull();
    expect(hasComfyUIControlNet()).toBe(false);
  });
  it('需 COMFYUI_ENABLED + COMFYUI_CONTROLNET_MODEL 同时具备', () => {
    const oe = process.env.COMFYUI_ENABLED, om = process.env.COMFYUI_CONTROLNET_MODEL;
    try {
      process.env.COMFYUI_ENABLED = 'true'; process.env.COMFYUI_CONTROLNET_MODEL = 'control_canny_xl.safetensors';
      expect(hasComfyUIControlNet()).toBe(true);
      process.env.COMFYUI_ENABLED = 'false';
      expect(hasComfyUIControlNet()).toBe(false); // 只配模型不够,还得开 ComfyUI
    } finally {
      if (oe === undefined) delete process.env.COMFYUI_ENABLED; else process.env.COMFYUI_ENABLED = oe;
      if (om === undefined) delete process.env.COMFYUI_CONTROLNET_MODEL; else process.env.COMFYUI_CONTROLNET_MODEL = om;
    }
  });
});

describe('v12.260 · 接线锁', () => {
  it('orchestrator 在有草图+启用时优先 generateWithControlNet,回落 IP-Adapter', () => {
    const o = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    expect(o).toContain('hasComfyUIControlNet');
    expect(o).toContain('generateWithControlNet');
    expect(o).toMatch(/opts\?\.sketchUrl && hasComfyUIControlNet\(\)/);
  });
});
