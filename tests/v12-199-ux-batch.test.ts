/**
 * v12.199 — UX 四项速修批接线锁(后端完整但前端零入口的能力补上入口)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.199 · UX 速修批', () => {
  it('① 决策日志面板挂技术监看台 + 调 decision-log API', () => {
    const panel = fs.readFileSync('components/project/decision-log-panel.tsx', 'utf-8');
    expect(panel).toContain('/decision-log');
    const page = fs.readFileSync('app/projects/[id]/page.tsx', 'utf-8');
    expect(page).toContain('DecisionLogPanel');
  });
  it('② director-console 变体「选为正片」→ ab-variant/choose', () => {
    const dc = fs.readFileSync('components/director-console.tsx', 'utf-8');
    expect(dc).toContain('ab-variant/choose');
    expect(dc).toContain('选为正片');
    expect(dc).toContain('chooseVariant');
  });
  it('③ 侧边栏补 IP市场/工作流/MasterPrompt 三入口(路由均存在)', () => {
    const sb = fs.readFileSync('components/sidebar.tsx', 'utf-8');
    expect(sb).toContain("href: '/cameo-market'");
    expect(sb).toContain("href: '/workflow-studio'");
    expect(sb).toContain("href: '/dashboard/master-prompt'");
    // 路由真实存在(非死链)
    expect(fs.existsSync('app/cameo-market')).toBe(true);
    expect(fs.existsSync('app/workflow-studio')).toBe(true);
    expect(fs.existsSync('app/dashboard/master-prompt')).toBe(true);
  });
  it('④ series 空态去除技术路径文案,改用户友好说明', () => {
    const sp = fs.readFileSync('app/dashboard/series/page.tsx', 'utf-8');
    expect(sp).not.toContain('POST /api/series');
    expect(sp).toContain('设为系列锚点');
  });
});
