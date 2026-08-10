/**
 * v12.251 — 编辑意图 → 执行计划(映射到既有 recompose / regenerate-shot)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { parseEditIntent } from '@/lib/edit-intent';
import { planExecution, hasExecutableRecompose } from '@/lib/edit-intent-execute';

describe('v12.251 planExecution', () => {
  it('组合级编辑合并成一次 recompose', () => {
    const p = planExecution(parseEditIntent('改成竖屏卡点字幕,适配抖音').intents);
    expect(p.recompose).toEqual({ aspect: '9:16', captionStyle: 'karaoke', platform: 'douyin' });
    expect(p.regenShots).toEqual([]);
    expect(p.destructive).toBe(false);
    expect(hasExecutableRecompose(p)).toBe(true);
  });

  it('删镜进 recompose.dropShots(去重升序),标破坏性', () => {
    const p = planExecution(parseEditIntent('删掉第3镜,删掉第1镜').intents);
    expect(p.recompose?.dropShots).toEqual([1, 3]);
    expect(p.destructive).toBe(true);
  });

  it('重配音进 recompose.regenVoiceover,标破坏性', () => {
    const p = planExecution(parseEditIntent('重新配音').intents);
    expect(p.recompose).toEqual({ regenVoiceover: true });
    expect(p.destructive).toBe(true);
  });

  it('重生镜不进 recompose,单列 regenShots,标破坏性', () => {
    const p = planExecution(parseEditIntent('第2镜调暗一点').intents);
    expect(p.recompose).toBeNull();
    expect(p.regenShots[0]).toMatchObject({ shotNumber: 2 });
    expect(p.destructive).toBe(true);
    expect(hasExecutableRecompose(p)).toBe(false);
  });

  it('节奏只作提示,不进 recompose、不算破坏性', () => {
    const p = planExecution(parseEditIntent('节奏快一点').intents);
    expect(p.recompose).toBeNull();
    expect(p.paceHint).toBe('fast');
    expect(p.destructive).toBe(false);
  });

  it('混合:删镜(组合级)+ 重生镜(另走)同时出现', () => {
    const p = planExecution(parseEditIntent('删掉第1镜,第2镜调暗一点').intents);
    expect(p.recompose?.dropShots).toEqual([1]);
    expect(p.regenShots.map(r => r.shotNumber)).toEqual([2]);
    expect(p.destructive).toBe(true);
  });

  it('空意图 → 全空计划,不破坏性', () => {
    const p = planExecution([]);
    expect(p).toEqual({ recompose: null, regenShots: [], paceHint: null, destructive: false });
  });
});

describe('v12.251 · edit-chat 执行闭环接线锁', () => {
  const page = fs.readFileSync('app/dashboard/edit-chat/page.tsx', 'utf-8');
  it('调既有 recompose 端点真执行(组合级编辑)', () => {
    expect(page).toContain('/recompose');
    expect(page).toContain('planExecution');
  });
  it('选项目 + 破坏性两步确认(armed)', () => {
    expect(page).toContain('api.projects');
    expect(page).toContain('armed');                 // 两步确认状态
    expect(page).toMatch(/plan\.destructive && !armed/); // 破坏性未 armed → 不执行只亮红
  });
  it('双击不能绕过两步确认(arm 后冷却禁用按钮)', () => {
    // 复检 high 修复:按钮 disabled 含 cooldown + execute 内冷却期忽略点击。
    expect(page).toMatch(/if \(cooldown\) return/);   // 冷却内点击忽略
    expect(page).toMatch(/\|\| cooldown/);            // 按钮 disabled 含 cooldown
    expect(page).toContain('setCooldown(true)');      // arm 时进冷却
  });
  it('重生镜/节奏如实指路,不假装执行', () => {
    expect(page).toMatch(/regenShots/);
    expect(page).toMatch(/paceHint/);
  });
});
