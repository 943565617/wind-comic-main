/**
 * v12.208 — Voice Clone 前端入口:route multipart 接收 + voice-shelf 克隆区块接线锁。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('v12.208 · Voice Clone UI', () => {
  it('route:multipart 音样文件直收(persistAsset 落盘→绝对URL→cloneVoice),保留 JSON 路径', () => {
    const r = fs.readFileSync('app/api/voice-clone/route.ts', 'utf-8');
    expect(r).toContain('multipart/form-data');
    expect(r).toContain('persistAsset');
    expect(r).toContain('5 * 1024 * 1024'); // ≤5MB 界
    expect(r).toContain('cloneVoice');
  });
  it('voice-shelf:上传音样→克隆→voiceId 进下拉可绑定角色', () => {
    const v = fs.readFileSync('components/project/voice-shelf.tsx', 'utf-8');
    expect(v).toContain('/api/voice-clone');
    expect(v).toContain('FormData');
    expect(v).toContain('doClone');
    expect(v).toContain('cloned.map'); // 克隆音色进下拉
    expect(v).toContain('[克隆]');
  });
});
