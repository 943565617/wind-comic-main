/**
 * v12.250 — C 三新模式的前端入口接线锁。
 *
 * 后端骨架(MV/漫转/对话式编辑)已就位;本测锁住「页面存在 + 调对端点 + 挂进侧边栏」,
 * 防止再犯「能力做了但前端没入口」的 UX 断层(参见 v12.210)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.250 · 三新模式前端入口', () => {
  it('① MV 卡点规划台:页面存在 + 调 /api/mv/plan', () => {
    expect(fs.existsSync('app/dashboard/mv/page.tsx')).toBe(true);
    const p = fs.readFileSync('app/dashboard/mv/page.tsx', 'utf-8');
    expect(p).toContain('/api/mv/plan');
    expect(p).toMatch(/musicDurationSec|bpm/);
  });

  it('② 漫转视频分格台:页面存在 + 调 /api/comic/panels + 落地上传', () => {
    expect(fs.existsSync('app/dashboard/comic/page.tsx')).toBe(true);
    const p = fs.readFileSync('app/dashboard/comic/page.tsx', 'utf-8');
    expect(p).toContain('/api/comic/panels');
    // 图片先经 upload 落地拿 URL(继承 SSRF/验签/白名单),不直传裸链
    expect(p).toContain('/api/upload/character-face');
  });

  it('③ 对话式编辑台:页面存在 + 调 /api/edit-intent/parse + 破坏性二次确认契约', () => {
    expect(fs.existsSync('app/dashboard/edit-chat/page.tsx')).toBe(true);
    const p = fs.readFileSync('app/dashboard/edit-chat/page.tsx', 'utf-8');
    expect(p).toContain('/api/edit-intent/parse');
    // 安全契约:执行按钮在骨架阶段禁用 + 破坏性提示,绝不误导「已执行」
    expect(p).toMatch(/destructive/);
    expect(p).toContain('disabled');
  });

  it('④ 三入口都挂进侧边栏,且各自页面存在', () => {
    const sb = fs.readFileSync('components/sidebar.tsx', 'utf-8');
    for (const href of ['/dashboard/mv', '/dashboard/comic', '/dashboard/edit-chat']) {
      expect(sb).toContain(`href: '${href}'`);
      expect(fs.existsSync(`app${href}/page.tsx`)).toBe(true);
    }
  });
});

// v12.250 UI 对抗复检修复锁(6 confirmed → 5 distinct):防回归。
describe('v12.250 · UI 复检修复锁', () => {
  it('edit-chat:异常返回不崩页 —— ok 守卫 + describe 数组归一/可选链', () => {
    const p = fs.readFileSync('app/dashboard/edit-chat/page.tsx', 'utf-8');
    expect(p).toContain('body.ok !== true');           // 200 非 JSON / 缺字段 → 明示报错
    expect(p).toContain('Array.isArray(body.describe)'); // 归一,渲染永不 undefined.length
    expect(p).toMatch(/describe\?\.length/);            // 渲染处可选链兜底
  });
  it('comic:上传/URL 抓取都有 try-catch(断网不静默)', () => {
    const p = fs.readFileSync('app/dashboard/comic/page.tsx', 'utf-8');
    // uploadFile 与 acceptUrl 各自 try/catch —— 至少两处 catch
    expect((p.match(/catch \(e\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });
  it('mv:beatsPerShot 参与禁用守卫 + 零镜头结果不与「未查询」混淆', () => {
    const p = fs.readFileSync('app/dashboard/mv/page.tsx', 'utf-8');
    expect(p).toContain('!(beatsPerShot > 0)');       // 0/清空不可提交
    expect(p).toContain('shots.length === 0');         // 空结果单独分支(显 summary)
  });
});
