/**
 * v12.145 — 创作偏好跨会话记忆(Miora Agent Memory 第一步):save/load 纯函数 + UI 接线锁。
 */
import { describe, it, expect } from 'vitest';
import { saveCreatePrefs, loadCreatePrefs } from '@/lib/create-prefs';
import fs from 'fs';

function memStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

describe('v12.145 · 创作偏好记忆', () => {
  it('save → load 往返(含 savedAt 时间戳)', () => {
    const st = memStorage();
    saveCreatePrefs({ style: 'cinematic', aspect: '9:16', sketchLock: true, scriptLanguage: 'ru' }, st);
    const p = loadCreatePrefs(st)!;
    expect(p.style).toBe('cinematic');
    expect(p.aspect).toBe('9:16');
    expect(p.sketchLock).toBe(true);
    expect(p.scriptLanguage).toBe('ru');
    expect(p.savedAt).toBeTruthy();
  });
  it('空/坏数据安全', () => {
    const st = memStorage();
    expect(loadCreatePrefs(st)).toBeNull();
    st.setItem('windcomic.createPrefs.v1', '{bad');
    expect(loadCreatePrefs(st)).toBeNull();
    expect(() => saveCreatePrefs({}, undefined)).not.toThrow(); // 无 localStorage 环境静默
  });
  it('UI 接线锁:挂载恢复 + 提交保存', () => {
    const ui = fs.readFileSync('app/dashboard/create/page.tsx', 'utf-8');
    expect(ui).toContain('loadCreatePrefs()');
    expect(ui).toContain('saveCreatePrefs({ style, aspect, cameraDefault, editStyle, scriptLanguage, sketchLock })');
  });
});
