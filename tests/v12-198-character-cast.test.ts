/**
 * v12.198 — 角色档案:净化纯函数(与 create-pipeline 同源)+ API/UI 接线锁。
 */
import { describe, it, expect } from 'vitest';
import { sanitizeLockedCharacters } from '@/lib/locked-characters';
import fs from 'fs';

describe('v12.198 · 角色档案', () => {
  it('净化:白名单 role/cw 钳制/硬上限3/滤无脸无名', () => {
    const out = sanitizeLockedCharacters([
      { name: ' 沈悦 ', role: 'lead', cw: 200, imageUrl: 'http://a/1.png' },
      { name: '', role: 'lead', imageUrl: 'http://a/x.png' }, // 无名滤掉
      { name: '路人', role: 'lead' },                          // 无脸滤掉
      { name: '反派', role: 'HACKER', cw: 5, imageUrl: 'http://a/2.png' }, // 非法 role→lead, cw 钳到 25
      { name: 'a', role: 'cameo', cw: 100, imageUrl: 'http://a/3.png' },
      { name: 'b', role: 'lead', cw: 100, imageUrl: 'http://a/4.png' }, // 第4个,被 slice 掉
    ]);
    expect(out.length).toBe(3);
    expect(out[0]).toMatchObject({ name: '沈悦', role: 'lead', cw: 125 }); // trim + cw 上限 125
    expect(out[1]).toMatchObject({ name: '反派', role: 'lead', cw: 25 });
  });
  it('净化:traits 白名单挡 JSON 注入', () => {
    const out = sanitizeLockedCharacters([
      { name: 'x', role: 'lead', imageUrl: 'http://a/1.png', traits: { gender: 'HACK', __proto__: {}, evil: 'x', appearance: 'y' } },
    ]);
    expect(out[0].traits?.gender).toBe('unknown'); // 非法枚举回退
    expect((out[0].traits as any)?.evil).toBeUndefined(); // 未白名单字段被剥
    expect(out[0].traits?.appearance).toBe('y');
  });
  it('非数组 → 空', () => {
    expect(sanitizeLockedCharacters(null)).toEqual([]);
    expect(sanitizeLockedCharacters('x' as any)).toEqual([]);
  });
  it('接线锁:API 双写 + create-pipeline 同源 + 项目页挂载', () => {
    const api = fs.readFileSync('app/api/projects/[id]/characters/route.ts', 'utf-8');
    expect(api).toContain('sanitizeLockedCharacters');
    expect(api).toContain('upsertLockedCharacters'); // 双写归一表
    expect(api).toContain("locked_characters: JSON.stringify(sanitized)");
    const cp = fs.readFileSync('lib/create-pipeline.ts', 'utf-8');
    expect(cp).toContain('sanitizeLockedCharacters(lockedCharacters)'); // 同一函数
    const page = fs.readFileSync('app/projects/[id]/page.tsx', 'utf-8');
    expect(page).toContain('CharacterCastPanel');
  });
});
