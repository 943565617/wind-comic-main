/**
 * v12.221 — 声音克隆授权门回归锁。
 *
 * 🔴-8 已亲验:克隆端点零授权/零核验,触《深度合成管理规定》第14条 + GDPR 第9条。
 * 本测试真行为断言:
 *   ①无 consent 的克隆请求 → 422(不进入克隆);
 *   ②带 consent 的请求 → consent_log 落库(who/purpose/declaration/ip);
 *   ③consent 校验拒绝「authorized 非 true / 缺 purpose / 缺 declaration」。
 *
 * 注:真正的 MiniMax 克隆调用需 hasVoiceClone()（官方端点 + key),测试环境未配 → 501,
 * 但授权门在 501 之前,故 422 路径可独立验证;consent_log 落库单独走 repo 验证。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';
import { signToken } from '@/app/api/auth/lib';
import { POST as voiceClonePOST } from '@/app/api/voice-clone/route';
import { recordConsent, listConsent } from '@/lib/repos/consent-log-repo';

const U = 'test-v12221-';
function tokenFor(id: string) { return signToken({ id, role: 'user' }); }
function jsonReq(body: any, token?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['authorization'] = `Bearer ${token}`;
  return new Request('http://localhost/api/voice-clone', { method: 'POST', headers, body: JSON.stringify(body) });
}
function cleanup() {
  db.prepare(`DELETE FROM consent_log WHERE user_id LIKE '${U}%'`).run();
}
beforeEach(cleanup);
afterEach(cleanup);

describe('v12.221 克隆授权门:无 consent → 422', () => {
  it('无 token → 401(先过登录)', async () => {
    const res = await voiceClonePOST(jsonReq({ sampleUrl: 'http://x/a.mp3' }) as any);
    expect(res.status).toBe(401);
  });

  it('有 token 但完全无 consent → 422', async () => {
    const res = await voiceClonePOST(jsonReq({ sampleUrl: 'http://x/a.mp3' }, tokenFor(U + 'a')) as any);
    expect([422, 501]).toContain(res.status); // 若环境未启用克隆会 501,但授权门在其后;无 consent 必先 422
    expect(res.status).toBe(422);
  });

  it('consent.authorized=false → 422', async () => {
    const res = await voiceClonePOST(jsonReq(
      { sampleUrl: 'http://x/a.mp3', consent: { authorized: false, purpose: 'ad', ownerDeclaration: 'ok' } },
      tokenFor(U + 'b'),
    ) as any);
    expect(res.status).toBe(422);
  });

  it('consent 缺 purpose → 422', async () => {
    const res = await voiceClonePOST(jsonReq(
      { sampleUrl: 'http://x/a.mp3', consent: { authorized: true, ownerDeclaration: 'ok' } },
      tokenFor(U + 'c'),
    ) as any);
    expect(res.status).toBe(422);
  });

  it('consent 缺 ownerDeclaration → 422', async () => {
    const res = await voiceClonePOST(jsonReq(
      { sampleUrl: 'http://x/a.mp3', consent: { authorized: true, purpose: 'ad' } },
      tokenFor(U + 'd'),
    ) as any);
    expect(res.status).toBe(422);
  });
});

describe('v12.221 consent_log 落库可追溯', () => {
  it('recordConsent 落库 → listConsent 查得(who/purpose/declaration/ip)', async () => {
    const uid = U + 'log';
    const id = await recordConsent({
      userId: uid, action: 'voice_clone', purpose: 'drama_production',
      ownerDeclaration: '我确认已获被克隆人授权', ip: '10.0.0.9',
    });
    expect(id).toMatch(/^consent_/);
    const rows = await listConsent(uid, 'voice_clone');
    expect(rows.length).toBe(1);
    expect(rows[0].user_id).toBe(uid);
    expect(rows[0].purpose).toBe('drama_production');
    expect(rows[0].owner_declaration).toContain('授权');
    expect(rows[0].ip).toBe('10.0.0.9');
    expect(rows[0].created_at).toBeTruthy();
  });

  it('listConsent 按 action 过滤', async () => {
    const uid = U + 'filter';
    await recordConsent({ userId: uid, action: 'voice_clone', purpose: 'p1', ownerDeclaration: 'd1' });
    await recordConsent({ userId: uid, action: 'other_action', purpose: 'p2', ownerDeclaration: 'd2' });
    expect((await listConsent(uid, 'voice_clone')).length).toBe(1);
    expect((await listConsent(uid)).length).toBe(2);
  });
});
