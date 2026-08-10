/** v12.246 — MV plan 端点:鉴权 + 输入校验 + 卡点计划返回。 */
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/auth-guard', () => ({
  requireUser: vi.fn(() => ({ ok: true, userId: 'u-mv-test' })),
}));
const { POST } = await import('@/app/api/mv/plan/route');
const { requireUser } = await import('@/lib/auth-guard');

function req(body: unknown): any {
  return { json: async () => body };
}

describe('v12.246 POST /api/mv/plan', () => {
  it('未登录 → 401', async () => {
    vi.mocked(requireUser).mockReturnValueOnce({ ok: false, status: 401, message: 'Unauthorized' } as any);
    const res = await POST(req({ musicDurationSec: 16, bpm: 120 }));
    expect(res.status).toBe(401);
  });

  it('合法输入 → 返回卡点镜头计划', async () => {
    const res = await POST(req({ musicDurationSec: 16, bpm: 120, beatsPerShot: 8 }));
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.shotCount).toBe(4);
    expect(j.shots[0].onBeat).toBe(true);
    expect(j.summary).toContain('镜');
  });

  it('副歌段加密体现在返回里', async () => {
    const res = await POST(req({
      musicDurationSec: 32, bpm: 120, beatsPerShot: 8,
      sections: [{ kind: 'chorus', startSec: 0, endSec: 32 }],
    }));
    const j = await res.json();
    expect(j.shots.every((s: any) => s.durationSec === 2)).toBe(true); // 8→4 拍 = 2s/镜
  });

  it('非法 musicDurationSec → 400', async () => {
    expect((await POST(req({ musicDurationSec: 0, bpm: 120 }))).status).toBe(400);
    expect((await POST(req({ musicDurationSec: 700, bpm: 120 }))).status).toBe(400); // 超 600 上限
  });

  it('非法 bpm → 400', async () => {
    expect((await POST(req({ musicDurationSec: 16, bpm: 0 }))).status).toBe(400);
    expect((await POST(req({ musicDurationSec: 16, bpm: 999 }))).status).toBe(400);
  });

  it('非法段落项被忽略,不污染计划', async () => {
    const res = await POST(req({
      musicDurationSec: 16, bpm: 120,
      sections: [{ kind: 'bogus', startSec: 0, endSec: 8 }, { kind: 'chorus', startSec: 8, endSec: 4 }],
    }));
    const j = await res.json();
    expect(j.ok).toBe(true); // 非法段落被过滤,退化为无段落规划
  });
});
