/**
 * v12.210 — UX 断层修复批:4 后端能力的前端入口接线锁。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.210 · UX 断层入口', () => {
  it('① heal-shots 一键自愈:组件调端点 + 挂项目页', () => {
    const c = fs.readFileSync('components/project/heal-shots-button.tsx', 'utf-8');
    expect(c).toContain('/heal-shots');
    const p = fs.readFileSync('app/projects/[id]/page.tsx', 'utf-8');
    expect(p).toContain('HealShotsButton');
  });
  it('② drama-package 出海打包:组件调端点 + 挂系列页 + JSON下载', () => {
    const c = fs.readFileSync('components/project/drama-package-button.tsx', 'utf-8');
    expect(c).toContain('/drama-package');
    expect(c).toMatch(/download|Blob|下载/);
    const s = fs.readFileSync('app/dashboard/series/[id]/page.tsx', 'utf-8');
    expect(s).toContain('DramaPackageButton');
  });
  it('③ url-to-brief 创意预填:create 页调端点 + 3s 超时降级', () => {
    const c = fs.readFileSync('app/dashboard/create/page.tsx', 'utf-8');
    expect(c).toContain('/api/tools/url-to-brief');
    expect(c).toMatch(/AbortController|setTimeout|3000/);
    expect(c).toContain('自动提取失败'); // 降级提示
  });
  it('④ 侧边栏角色库入口(characters 页存在)', () => {
    const sb = fs.readFileSync('components/sidebar.tsx', 'utf-8');
    expect(sb).toContain("href: '/dashboard/characters'");
    expect(fs.existsSync('app/dashboard/characters/page.tsx')).toBe(true);
  });
});
