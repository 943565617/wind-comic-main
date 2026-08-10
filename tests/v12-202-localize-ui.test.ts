/**
 * v12.202 — 出海多语 UI:LocalizePanel 接线锁(生成/套用两段流程 + 语种表 + TTS 降级提示)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.202 · 出海多语 UI', () => {
  it('LocalizePanel:调 localize + 生成/套用两段 + 母语 zh 排除', () => {
    const p = fs.readFileSync('components/project/localize-panel.tsx', 'utf-8');
    expect(p).toContain('/localize');
    expect(p).toContain("body: JSON.stringify({ language: lang, apply })"); // 生成(apply=false)+套用(apply=true)同端点
    expect(p).toContain("l.code !== 'zh'"); // 母语无需译制
    expect(p).toContain('ttsReliable'); // TTS 不可靠语种如实提示
  });
  it('挂载在项目页(交付/分发区,DistributionPanel 之上)', () => {
    const page = fs.readFileSync('app/projects/[id]/page.tsx', 'utf-8');
    expect(page).toContain('LocalizePanel');
    const li = page.indexOf('<LocalizePanel');
    const di = page.indexOf('<DistributionPanel');
    expect(li).toBeGreaterThan(0);
    expect(li).toBeLessThan(di); // 多语版在分发之前(先译制再分发)
  });
});
