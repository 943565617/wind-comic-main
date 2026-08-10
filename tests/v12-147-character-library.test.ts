/**
 * v12.147 — 角色跨项目带出(Agent Memory 深化):fillFirstEmptySlot 纯函数 + UI 接线锁。
 */
import { describe, it, expect } from 'vitest';
import { fillFirstEmptySlot, type LockedCharacter } from '@/components/create/character-lock-section';
import fs from 'fs';

const slot = (p: Partial<LockedCharacter>): LockedCharacter => ({ name: '', role: 'lead', cw: 125, imageUrl: '', ...p });

describe('v12.147 · fillFirstEmptySlot', () => {
  it('填第一个真空槽(name+imageUrl 都空),保留槽位 role/cw', () => {
    const slots = [slot({ name: '主角A', imageUrl: 'http://a' }), slot({ role: 'supporting', cw: 100 }), slot({})];
    const r = fillFirstEmptySlot(slots, { name: '柳如烟', imageUrl: 'http://lib/1.png' })!;
    expect(r.idx).toBe(1);
    expect(r.next[1].name).toBe('柳如烟');
    expect(r.next[1].role).toBe('supporting'); // 槽位定位不被覆盖
    expect(r.next[0].name).toBe('主角A');      // 已占槽不动
  });
  it('半空槽(只有名字没图)不算空;全满 → null', () => {
    const halfFull = [slot({ name: '手填中' }), slot({ imageUrl: 'http://x' }), slot({ name: 'B', imageUrl: 'http://b' })];
    expect(fillFirstEmptySlot(halfFull, { name: 'X', imageUrl: 'http://y' })).toBeNull();
  });
  it('UI 接线锁:懒加载 fetch + 库条 + 失效缩略图隐藏', () => {
    const src = fs.readFileSync('components/create/character-lock-section.tsx', 'utf-8');
    expect(src).toContain("fetch('/api/global-assets?type=character&limit=12')");
    expect(src).toContain('从角色库带出');
    expect(src).toContain('onError'); // 临时路径缩略图 404 → 整项隐藏
    expect(src).toContain('char-library-toggle');
  });
});
